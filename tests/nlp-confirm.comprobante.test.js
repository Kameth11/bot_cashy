// Un movimiento leído de una foto/PDF usa la misma confirmación que el texto,
// con el detalle del comprobante; al guardar, el comprobante queda
// registrado y vinculado al movimiento.

jest.mock('../src/lib/telegraf', () => ({ bot: { action: jest.fn(), on: jest.fn() } }));
jest.mock('telegraf', () => ({
  Markup: {
    inlineKeyboard: jest.fn((rows) => ({ reply_markup: { inline_keyboard: rows } })),
    button: { callback: jest.fn((label, id) => ({ text: label, callback_data: id })) },
  },
}));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/config', () => ({ AUTHORIZED_USER_ID: 1111, ALLOWED_EMAILS: [], CODIGO_EXPIRACION_HORAS: 24, DASHBOARD_URL: null }));

jest.mock('../src/services/command.service', () => ({ registrarMovimientoDesdeNLP: jest.fn() }));
jest.mock('../src/services/personal.service', () => ({
  registrarMovimientoPersonal: jest.fn(),
  evaluarPresupuesto: jest.fn().mockResolvedValue(null),
  fechaStrAIso: jest.requireActual('../src/services/personal.service').fechaStrAIso,
  mesActualIso: jest.fn(() => '2026-09'),
}));
jest.mock('../src/handlers/comprobante', () => ({ registrarComprobanteDesdeEntities: jest.fn().mockResolvedValue('comp_1') }));

const state = require('../src/state');
const cmd = require('../src/services/command.service');
const personalService = require('../src/services/personal.service');
const { registrarComprobanteDesdeEntities } = require('../src/handlers/comprobante');
const { crearMensajeConfirmacion, handleNlpSave } = require('../src/handlers/nlp-confirm');

function entitiesFactura(extra = {}) {
  return {
    tipo: 'gasto', descripcion: 'Insumos - Dental_Sur', monto: 45300, moneda: 'Pesos', metodo_pago: 'tarjeta',
    estado: 'Pendiente', categoria: 'insumos', proveedorNombre: 'Dental_Sur', fechaVencimiento: '15/10/2026',
    ambito: 'consultorio', referenciaId: 'comp:comp_1',
    comprobante: {
      id: 'comp_1', tipo: 'factura', tipoDocumento: 'factura', letra: 'B', numero: '0003-00001234',
      cuit: '30-71234567-8', fechaEmision: '01/09/2026', items: [{ descripcion: 'Guantes' }], duplicado: null,
    },
    ...extra,
  };
}

function ctxFor(userId) {
  return { from: { id: userId }, answerCbQuery: jest.fn(async () => {}), reply: jest.fn(async () => {}), editMessageText: jest.fn(async () => {}) };
}

beforeEach(() => jest.clearAllMocks());

test('el mensaje muestra comprobante, vencimiento e ítems (escapando Markdown)', () => {
  const msg = crearMensajeConfirmacion(entitiesFactura());
  expect(msg).toContain('Proveedor: Dental\\_Sur');
  expect(msg).toContain('factura B 0003-00001234');
  expect(msg).toContain('CUIT 30-71234567-8');
  expect(msg).toContain('Vence: 15/10/2026');
  expect(msg).toContain('Ítems: 1');
  expect(msg).toContain('Pendiente');
  expect(msg).not.toContain('Tratamiento');
});

test('avisa si parece duplicado', () => {
  const e = entitiesFactura();
  e.comprobante.duplicado = { motivo: 'mismo_archivo', fechaCarga: '01/09/2026 10:00' };
  expect(crearMensajeConfirmacion(e)).toContain('Esta misma imagen ya se cargó');
});

test('guardar (consultorio) registra el comprobante con el ID del movimiento', async () => {
  cmd.registrarMovimientoDesdeNLP.mockResolvedValue({ success: true, idUnico: 'mov_9', mensaje: 'ok' });
  state.pendingNlpMovimientos.set(2222, { entities: entitiesFactura() });
  await handleNlpSave(ctxFor(2222));

  expect(cmd.registrarMovimientoDesdeNLP).toHaveBeenCalledWith(2222, expect.objectContaining({ referenciaId: 'comp:comp_1', fechaVencimiento: '15/10/2026' }));
  expect(registrarComprobanteDesdeEntities).toHaveBeenCalledWith(2222, expect.objectContaining({ referenciaId: 'comp:comp_1' }), { idMovimiento: 'mov_9' });
});

test('si el movimiento pide un dato más (método de pago), el comprobante igual queda registrado', async () => {
  cmd.registrarMovimientoDesdeNLP.mockResolvedValue({ necesitaInfo: true, mensaje: '¿Método?' });
  state.pendingNlpMovimientos.set(2222, { entities: entitiesFactura({ estado: 'Cobrado', metodo_pago: null }) });
  await handleNlpSave(ctxFor(2222));
  expect(registrarComprobanteDesdeEntities).toHaveBeenCalledWith(2222, expect.anything(), { idMovimiento: null });
});

test('guardar (personal) pasa el vínculo en Notas y registra el comprobante', async () => {
  personalService.registrarMovimientoPersonal.mockResolvedValue({
    movimiento: { idMov: 'pmov_1', descripcion: 'Súper', monto: 20000, moneda: 'Pesos', categoria: 'supermercado', tipo: 'Egreso' },
    viaje: null,
  });
  state.pendingNlpMovimientos.set(2222, { entities: entitiesFactura({ ambito: 'personal', categoria: 'supermercado' }) });
  await handleNlpSave(ctxFor(2222));

  expect(personalService.registrarMovimientoPersonal).toHaveBeenCalledWith(2222, expect.objectContaining({ notas: 'comp:comp_1' }));
  expect(registrarComprobanteDesdeEntities).toHaveBeenCalledWith(2222, expect.anything(), { idMovimiento: 'pmov_1' });
});

test('un movimiento de texto (sin comprobante) no registra nada extra', async () => {
  cmd.registrarMovimientoDesdeNLP.mockResolvedValue({ success: true, idUnico: 'mov_1', mensaje: 'ok' });
  state.pendingNlpMovimientos.set(2222, { entities: { tipo: 'gasto', descripcion: 'Luz', monto: 100, ambito: 'consultorio' } });
  await handleNlpSave(ctxFor(2222));
  expect(registrarComprobanteDesdeEntities).not.toHaveBeenCalled();
});

describe('guardar personal: aviso cuando la fecha cae en otro mes', () => {
  const guardarConFecha = async (fecha, tipo = 'Egreso') => {
    personalService.registrarMovimientoPersonal.mockResolvedValue({
      movimiento: { idMov: 'p1', descripcion: 'Transferencia', monto: 5000, moneda: 'Pesos', categoria: 'otros', tipo, fecha },
      viaje: null,
    });
    state.pendingNlpMovimientos.set(2222, { entities: entitiesFactura({ ambito: 'personal', categoria: 'otros' }) });
    const ctx = ctxFor(2222);
    await handleNlpSave(ctx);
    return ctx.editMessageText.mock.calls[0][0];
  };

  test('fecha del mes actual: sin aviso, pero con la fecha visible', async () => {
    const msg = await guardarConFecha('15/09/2026');
    expect(msg).toContain('📅 15/09/2026');
    expect(msg).not.toContain('otro mes');
  });

  test('fecha de otro mes: avisa en qué mes lo va a encontrar', async () => {
    const msg = await guardarConFecha('15/08/2026');
    expect(msg).toContain('otro mes');
    expect(msg).toContain('2026-08');
  });

  test('el título refleja Ingreso vs Gasto', async () => {
    expect(await guardarConFecha('15/09/2026', 'Ingreso')).toContain('Ingreso personal registrado');
    expect(await guardarConFecha('15/09/2026', 'Egreso')).toContain('Gasto personal registrado');
  });
});
