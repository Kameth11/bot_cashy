jest.mock('../src/lib/telegraf', () => ({ bot: { action: jest.fn(), on: jest.fn() } }));
jest.mock('telegraf', () => ({
  Markup: {
    inlineKeyboard: jest.fn((rows) => ({ reply_markup: { inline_keyboard: rows } })),
    button: { callback: jest.fn((label, id) => ({ text: label, callback_data: id })) },
  },
}));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/config', () => ({ AUTHORIZED_USER_ID: 1111, ALLOWED_EMAILS: [], CODIGO_EXPIRACION_HORAS: 24, DASHBOARD_URL: null }));
jest.mock('../src/services/cliente.service', () => ({
  get clientes() { return { '2222': { email: 'o@t.com', sheetId: 's', usuarios: [3333], permisos: {} } }; },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));
jest.mock('../src/services/command.service', () => ({ registrarMovimientoDesdeNLP: jest.fn() }));
jest.mock('../src/services/personal.service', () => ({
  obtenerViajeActivo: jest.fn().mockResolvedValue(null),
  correspondeAlViaje: jest.fn().mockReturnValue(false),
  fechaHoyStr: jest.fn().mockReturnValue('01/01/2026'),
  guardarPreferencia: jest.fn().mockResolvedValue(true),
}));
jest.mock('../src/services/personal-nlp.service', () => ({ inferirCategoriaPersonal: jest.fn().mockReturnValue('supermercado') }));
jest.mock('../src/services/casa.service', () => {
  class CasaError extends Error { constructor(code) { super(code); this.code = code; } }
  return {
    CasaError,
    listarMisCasas: jest.fn(),
    listarMiembros: jest.fn(),
    registrarGasto: jest.fn(),
    calcularSaldosCasa: jest.fn(),
  };
});

const state = require('../src/state');
const cmd = require('../src/services/command.service');
const personalService = require('../src/services/personal.service');
const casaService = require('../src/services/casa.service');
const {
  crearMensajeConfirmacion, confirmationButtons, handleNlpSetAmbito, handleNlpSave, actualizarCampoNlp,
} = require('../src/handlers/nlp-confirm');

const { CasaError } = casaService;
const MIEMBROS = [
  { id: 'm1', userId: '2222', nombre: 'Ana' },
  { id: 'm2', userId: '4444', nombre: 'Beto' },
  { id: 'm3', userId: '', nombre: 'Tomás' },
];
const CASAS = [{ casaId: 'casa_1', nombre: 'Casa' }, { casaId: 'casa_2', nombre: 'Casa Dinamarca' }];

const baseEntities = (extra = {}) => ({
  tipo: 'gasto', descripcion: 'super', monto: 45000, moneda: 'Pesos', metodo_pago: 'efectivo', categoria: 'insumos',
  ambito: 'consultorio', textoOriginal: 'super 45000 casa', terminoAmbito: null, casasDisponibles: CASAS, ...extra,
});
const entitiesCasa = (extra = {}) => baseEntities({
  ambito: 'casa', casaId: 'casa_2', casaNombre: 'Casa Dinamarca', categoria: 'supermercado', categoriaConsultorio: 'insumos',
  miembrosCasa: MIEMBROS.map(({ id, nombre }) => ({ id, nombre })), pagoPorId: 'm1', pagoPorNombre: 'Ana', repartoIds: null, repartoNombres: null, ...extra,
});
const callbacks = (kb) => kb.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);

function ctxFor(userId, match) {
  return {
    from: { id: userId }, match,
    answerCbQuery: jest.fn(async () => {}), reply: jest.fn(async () => {}), editMessageText: jest.fn(async () => {}),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.pendingNlpMovimientos.clear();
  casaService.listarMisCasas.mockReturnValue(CASAS);
  casaService.listarMiembros.mockResolvedValue(MIEMBROS);
});

describe('mensaje de confirmación de casa', () => {
  test('muestra casa, quién pagó y reparto entre todos', () => {
    const msg = crearMensajeConfirmacion(entitiesCasa());
    expect(msg).toContain('🏡 Casa — Casa Dinamarca');
    expect(msg).toContain('Pagó: Ana');
    expect(msg).toContain('Reparto: todos (Ana, Beto y Tomás)');
    expect(msg).toContain('Egreso');
  });

  test('con reparto elegido lista solo a esos', () => {
    const msg = crearMensajeConfirmacion(entitiesCasa({ repartoIds: ['m1', 'm2'], repartoNombres: ['Ana', 'Beto'] }));
    expect(msg).toContain('Reparto: Ana y Beto');
  });

  test('muestra el aviso de reparto', () => {
    expect(crearMensajeConfirmacion(entitiesCasa({ avisoReparto: 'No encontré a zoe' }))).toContain('No encontré a zoe');
  });
});

describe('botones', () => {
  test('sin casas: el toggle de siempre', () => {
    const cb = callbacks(confirmationButtons({ tipo: 'gasto', ambito: 'consultorio' }));
    expect(cb).toContain('nlp_toggle_ambito');
    expect(cb.some((c) => c.startsWith('nlp_set_ambito'))).toBe(false);
  });

  test('con casas desde consultorio: personal y cada casa (sin consultorio)', () => {
    const cb = callbacks(confirmationButtons(baseEntities()));
    expect(cb).toEqual(expect.arrayContaining(['nlp_set_ambito:personal', 'nlp_set_ambito:casa:casa_1', 'nlp_set_ambito:casa:casa_2']));
    expect(cb).not.toContain('nlp_set_ambito:consultorio');
    expect(cb).not.toContain('nlp_toggle_ambito');
  });

  test('desde una casa: no ofrece la casa actual', () => {
    const cb = callbacks(confirmationButtons(entitiesCasa()));
    expect(cb).not.toContain('nlp_set_ambito:casa:casa_2');
    expect(cb).toEqual(expect.arrayContaining(['nlp_set_ambito:consultorio', 'nlp_set_ambito:personal', 'nlp_set_ambito:casa:casa_1']));
  });

  test('un ingreso no ofrece casas', () => {
    const cb = callbacks(confirmationButtons(baseEntities({ tipo: 'ingreso' })));
    expect(cb.some((c) => c.startsWith('nlp_set_ambito:casa'))).toBe(false);
  });
});

describe('handleNlpSetAmbito', () => {
  test('a una casa: valida membresía, carga miembros y pagó/reparto, aprende la preferencia', async () => {
    state.pendingNlpMovimientos.set(2222, { entities: baseEntities({ terminoAmbito: 'super' }) });
    const ctx = ctxFor(2222, ['x', 'casa:casa_2']);
    await handleNlpSetAmbito(ctx);

    const e = state.pendingNlpMovimientos.get(2222).entities;
    expect(e).toMatchObject({ ambito: 'casa', casaId: 'casa_2', casaNombre: 'Casa Dinamarca', pagoPorId: 'm1', repartoIds: null, categoria: 'supermercado', categoriaConsultorio: 'insumos' });
    expect(personalService.guardarPreferencia).toHaveBeenCalledWith(2222, 'super', 'casa:casa_2');
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining('Casa Dinamarca'), expect.anything());
  });

  test('un callback FORJADO hacia una casa ajena se rechaza y no cambia nada', async () => {
    state.pendingNlpMovimientos.set(2222, { entities: baseEntities() });
    const ctx = ctxFor(2222, ['x', 'casa:casa_ajena']);
    await handleNlpSetAmbito(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No pertenecés'));
    expect(state.pendingNlpMovimientos.get(2222).entities.ambito).toBe('consultorio');
    expect(casaService.listarMiembros).not.toHaveBeenCalled();
  });

  test('un target inválido se rechaza', async () => {
    state.pendingNlpMovimientos.set(2222, { entities: baseEntities() });
    const ctx = ctxFor(2222, ['x', 'casa:<script>']);
    await handleNlpSetAmbito(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('no válida'));
    expect(state.pendingNlpMovimientos.get(2222).entities.ambito).toBe('consultorio');
  });

  test('un ingreso no puede pasar a una casa', async () => {
    state.pendingNlpMovimientos.set(2222, { entities: baseEntities({ tipo: 'ingreso' }) });
    const ctx = ctxFor(2222, ['x', 'casa:casa_1']);
    await handleNlpSetAmbito(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('solo se cargan gastos'));
    expect(state.pendingNlpMovimientos.get(2222).entities.ambito).toBe('consultorio');
  });

  test('si la casa no se puede leer, avisa y no cambia', async () => {
    state.pendingNlpMovimientos.set(2222, { entities: baseEntities() });
    casaService.listarMiembros.mockRejectedValue(new CasaError('no_miembro'));
    const ctx = ctxFor(2222, ['x', 'casa:casa_1']);
    await handleNlpSetAmbito(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No pertenecés'));
    expect(state.pendingNlpMovimientos.get(2222).entities.ambito).toBe('consultorio');
  });

  test('de casa a consultorio restaura la categoría clínica y limpia los datos de la casa', async () => {
    state.pendingNlpMovimientos.set(2222, { entities: entitiesCasa() });
    await handleNlpSetAmbito(ctxFor(2222, ['x', 'consultorio']));
    const e = state.pendingNlpMovimientos.get(2222).entities;
    expect(e).toMatchObject({ ambito: 'consultorio', categoria: 'insumos', casaId: null, pagoPorId: null, miembrosCasa: null });
  });

  test('de casa a personal NO pisa la categoría clínica guardada', async () => {
    state.pendingNlpMovimientos.set(2222, { entities: entitiesCasa() });
    await handleNlpSetAmbito(ctxFor(2222, ['x', 'personal']));
    const e = state.pendingNlpMovimientos.get(2222).entities;
    expect(e).toMatchObject({ ambito: 'personal', categoriaConsultorio: 'insumos', casaId: null });
  });

  test('un invitado no puede pasar a personal con el selector', async () => {
    state.pendingNlpMovimientos.set(3333, { entities: baseEntities() });
    const ctx = ctxFor(3333, ['x', 'personal']);
    await handleNlpSetAmbito(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('solo para el dueño'));
    expect(state.pendingNlpMovimientos.get(3333).entities.ambito).toBe('consultorio');
  });
});

describe('guardar un gasto de casa', () => {
  test('registra en la casa con pagó y reparto, no toca el consultorio, y muestra saldos', async () => {
    state.pendingNlpMovimientos.set(2222, { entities: entitiesCasa({ repartoIds: ['m1', 'm2'], pagoPorId: 'm2', pagoPorNombre: 'Beto', fecha: '05/10/2026' }) });
    casaService.registrarGasto.mockResolvedValue({
      movimiento: { descripcion: 'super', monto: 45000, moneda: 'Pesos', pagoPor: 'm2', repartoEntre: ['m1', 'm2'], categoria: 'supermercado' },
      miembros: MIEMBROS,
    });
    casaService.calcularSaldosCasa.mockResolvedValue({ saldos: { Pesos: { transferencias: [{ deNombre: 'Ana', paraNombre: 'Beto', monto: 22500 }] } } });

    const ctx = ctxFor(2222);
    await handleNlpSave(ctx);

    expect(casaService.registrarGasto).toHaveBeenCalledWith(2222, 'casa_2', expect.objectContaining({
      descripcion: 'super', monto: 45000, moneda: 'Pesos', metodoPago: 'efectivo', categoria: 'supermercado',
      pagoPor: 'm2', repartoEntre: ['m1', 'm2'], fecha: '05/10/2026',
    }));
    expect(cmd.registrarMovimientoDesdeNLP).not.toHaveBeenCalled();
    const msg = ctx.editMessageText.mock.calls[0][0];
    expect(msg).toContain('Gasto registrado en Casa Dinamarca');
    expect(msg).toContain('Pagó: Beto');
    expect(msg).toContain('Reparto: Ana y Beto');
    expect(msg).toContain('Ana → Beto: $22.500');
  });

  test('reparto de todos se informa como "todos"; sin reparto explícito se manda undefined', async () => {
    state.pendingNlpMovimientos.set(2222, { entities: entitiesCasa() });
    casaService.registrarGasto.mockResolvedValue({
      movimiento: { descripcion: 'super', monto: 45000, moneda: 'Pesos', pagoPor: 'm1', repartoEntre: ['m1', 'm2', 'm3'], categoria: 'supermercado' },
      miembros: MIEMBROS,
    });
    casaService.calcularSaldosCasa.mockRejectedValue(new Error('sheet'));
    const ctx = ctxFor(2222);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await handleNlpSave(ctx);
    expect(casaService.registrarGasto.mock.calls[0][2].repartoEntre).toBeUndefined();
    expect(ctx.editMessageText.mock.calls[0][0]).toContain('Reparto: todos'); // aunque fallen los saldos, el gasto quedó
  });

  test('un CasaError se informa claro y no se pierde el control', async () => {
    state.pendingNlpMovimientos.set(2222, { entities: entitiesCasa() });
    casaService.registrarGasto.mockRejectedValue(new CasaError('no_miembro'));
    const ctx = ctxFor(2222);
    await handleNlpSave(ctx);
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining('No pertenecés'));
  });

  test('un error inesperado no se filtra', async () => {
    state.pendingNlpMovimientos.set(2222, { entities: entitiesCasa() });
    casaService.registrarGasto.mockRejectedValue(new Error('detalle interno'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = ctxFor(2222);
    await handleNlpSave(ctx);
    const msg = ctx.editMessageText.mock.calls[0][0];
    expect(msg).toMatch(/Error al guardar/);
    expect(msg).not.toMatch(/detalle interno/);
  });
});

describe('editar pagó y reparto', () => {
  const pending = (campo) => ({ entities: entitiesCasa(), editingCampo: campo });

  test('pagó: por nombre', async () => {
    const ctx = ctxFor(2222);
    await actualizarCampoNlp(ctx, 2222, pending('pagoPor'), 'beto');
    const e = state.pendingNlpMovimientos.get(2222).entities;
    expect(e).toMatchObject({ pagoPorId: 'm2', pagoPorNombre: 'Beto' });
  });

  test('pagó: nombre inexistente o ambiguo no cambia nada', async () => {
    const ctx = ctxFor(2222);
    await actualizarCampoNlp(ctx, 2222, pending('pagoPor'), 'Zoe');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No encontré'));
    expect(state.pendingNlpMovimientos.has(2222)).toBe(false);
  });

  test('reparto: lista de nombres', async () => {
    const ctx = ctxFor(2222);
    await actualizarCampoNlp(ctx, 2222, pending('reparto'), 'Ana y Tomás');
    expect(state.pendingNlpMovimientos.get(2222).entities).toMatchObject({ repartoIds: ['m1', 'm3'], repartoNombres: ['Ana', 'Tomás'] });
  });

  test('reparto: "todos" vuelve al reparto general', async () => {
    const ctx = ctxFor(2222);
    const p = { entities: entitiesCasa({ repartoIds: ['m1'], repartoNombres: ['Ana'] }), editingCampo: 'reparto' };
    await actualizarCampoNlp(ctx, 2222, p, 'todos');
    expect(state.pendingNlpMovimientos.get(2222).entities).toMatchObject({ repartoIds: null, repartoNombres: null });
  });

  test('reparto: un nombre desconocido se rechaza sin guardar parcial', async () => {
    const ctx = ctxFor(2222);
    await actualizarCampoNlp(ctx, 2222, pending('reparto'), 'Ana y Zoe');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('zoe'));
    expect(state.pendingNlpMovimientos.has(2222)).toBe(false);
  });
});
