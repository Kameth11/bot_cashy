jest.mock('../src/lib/telegraf', () => ({ bot: { action: jest.fn(), on: jest.fn() } }));
jest.mock('telegraf', () => ({
  Markup: {
    inlineKeyboard: jest.fn((rows) => ({ reply_markup: { inline_keyboard: rows } })),
    button: { callback: jest.fn((label, id) => ({ text: label, callback_data: id })) },
  },
}));
jest.mock('../src/services/command.service', () => ({
  registrarMovimientoDesdeNLP: jest.fn(),
}));

const state = require('../src/state');
const {
  crearMensajeConfirmacion,
  actualizarCampoNlp,
  handleNlpSave,
  handleNlpCancel,
  handleNlpEdit,
  handleNlpEditMonto,
  handleNlpEditPaciente,
  handleNlpEditMetodo,
  handleNlpEditTipo,
  handleNlpEditEstado,
  handleNlpEditReescribir,
  handleNlpKeepOld,
  handleNlpDiscardOld,
} = require('../src/handlers/nlp-confirm');
const cmd = require('../src/services/command.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(userId = 1) {
  return {
    from: { id: userId },
    answerCbQuery: jest.fn(async () => {}),
    reply: jest.fn(async () => {}),
    editMessageText: jest.fn(async () => {}),
  };
}

const BASE_ENTITIES = {
  tipo: 'ingreso',
  monto: 15000,
  moneda: 'Pesos',
  descripcion: 'Juan Perez',
  metodo_pago: 'efectivo',
  estado: 'Cobrado',
  pacienteNombre: 'Juan Perez',
  tratamientoNombre: null,
  categoria: 'consulta',
};

beforeEach(() => {
  state.pendingNlpMovimientos.clear();
  jest.clearAllMocks();
});

// ── crearMensajeConfirmacion ──────────────────────────────────────────────────

describe('crearMensajeConfirmacion', () => {
  test('incluye tipo Ingreso con emoji verde', () => {
    const msg = crearMensajeConfirmacion({ tipo: 'ingreso', monto: 15000, moneda: 'Pesos' });
    expect(msg).toContain('Ingreso 💚');
  });

  test('incluye tipo Egreso con emoji rojo', () => {
    const msg = crearMensajeConfirmacion({ tipo: 'gasto', monto: 5000, moneda: 'Pesos' });
    expect(msg).toContain('Egreso 🔴');
  });

  test('muestra monto en pesos con símbolo $', () => {
    const msg = crearMensajeConfirmacion({ tipo: 'ingreso', monto: 15000, moneda: 'Pesos' });
    expect(msg).toContain('$15.000');
    expect(msg).toContain('pesos');
  });

  test('muestra monto en dólares con símbolo U$', () => {
    const msg = crearMensajeConfirmacion({ tipo: 'ingreso', monto: 50, moneda: 'Dólares' });
    expect(msg).toContain('U$50');
    expect(msg).toContain('dólares');
  });

  test('muestra monto en euros con símbolo €', () => {
    const msg = crearMensajeConfirmacion({ tipo: 'ingreso', monto: 200, moneda: 'Euros' });
    expect(msg).toContain('€200');
    expect(msg).toContain('euros');
  });

  test('muestra — cuando monto es null', () => {
    const msg = crearMensajeConfirmacion({ tipo: 'ingreso', monto: null, moneda: 'Pesos' });
    expect(msg).toMatch(/Monto: —/);
  });

  test('muestra — cuando paciente es null', () => {
    const msg = crearMensajeConfirmacion({ tipo: 'ingreso', monto: 100, pacienteNombre: null });
    expect(msg).toMatch(/Paciente: —/);
  });

  test('muestra estado Pendiente con emoji ⏳', () => {
    const msg = crearMensajeConfirmacion({ tipo: 'ingreso', monto: 100, estado: 'Pendiente' });
    expect(msg).toContain('Pendiente ⏳');
  });

  test('muestra método capitalizado', () => {
    const msg = crearMensajeConfirmacion({ tipo: 'ingreso', monto: 100, metodo_pago: 'efectivo' });
    expect(msg).toContain('Efectivo');
  });

  test('incluye texto de confirmación al final', () => {
    const msg = crearMensajeConfirmacion(BASE_ENTITIES);
    expect(msg).toContain('¿Es correcto?');
  });

  test('muestra Proveedor para egresos en lugar de Paciente', () => {
    const msg = crearMensajeConfirmacion({
      tipo: 'gasto',
      monto: 400,
      moneda: 'Euros',
      proveedorNombre: 'Gasista',
      pacienteNombre: null,
    });
    expect(msg).toContain('Proveedor: Gasista');
    expect(msg).not.toContain('Paciente:');
  });

  test('muestra Paciente para ingresos en lugar de Proveedor', () => {
    const msg = crearMensajeConfirmacion({
      tipo: 'ingreso',
      monto: 15000,
      moneda: 'Pesos',
      pacienteNombre: 'Juan Perez',
      proveedorNombre: null,
    });
    expect(msg).toContain('Paciente: Juan Perez');
    expect(msg).not.toContain('Proveedor:');
  });

  test('muestra Proveedor — cuando egreso no tiene proveedor', () => {
    const msg = crearMensajeConfirmacion({
      tipo: 'gasto',
      monto: 5000,
      moneda: 'Pesos',
      proveedorNombre: null,
    });
    expect(msg).toContain('Proveedor: —');
    expect(msg).not.toContain('Paciente:');
  });
});

// ── handleNlpSave ─────────────────────────────────────────────────────────────

describe('handleNlpSave', () => {
  test('limpia estado y guarda cuando hay pendiente exitoso', async () => {
    const userId = 10;
    state.pendingNlpMovimientos.set(userId, { entities: BASE_ENTITIES, editingCampo: null });
    cmd.registrarMovimientoDesdeNLP.mockResolvedValueOnce({ success: true, mensaje: 'ok:guardado' });

    const ctx = makeCtx(userId);
    await handleNlpSave(ctx);

    expect(state.pendingNlpMovimientos.has(userId)).toBe(false);
    expect(cmd.registrarMovimientoDesdeNLP).toHaveBeenCalledWith(userId, BASE_ENTITIES);
    expect(ctx.editMessageText).toHaveBeenCalledWith('ok:guardado', { parse_mode: 'Markdown' });
  });

  test('responde que expiró cuando no hay pendiente', async () => {
    const ctx = makeCtx(99);
    await handleNlpSave(ctx);
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining('expiró'));
    expect(cmd.registrarMovimientoDesdeNLP).not.toHaveBeenCalled();
  });

  test('muestra mensaje de info adicional cuando necesitaInfo es true', async () => {
    const userId = 11;
    state.pendingNlpMovimientos.set(userId, { entities: BASE_ENTITIES, editingCampo: null });
    cmd.registrarMovimientoDesdeNLP.mockResolvedValueOnce({
      necesitaInfo: true,
      campo: 'cotizacion',
      mensaje: '¿Cuál es la cotización?',
    });

    const ctx = makeCtx(userId);
    await handleNlpSave(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('¿Cuál es la cotización?', { parse_mode: 'Markdown' });
  });
});

// ── handleNlpCancel ───────────────────────────────────────────────────────────

describe('handleNlpCancel', () => {
  test('elimina el pendiente y responde Cancelado', async () => {
    const userId = 20;
    state.pendingNlpMovimientos.set(userId, { entities: BASE_ENTITIES, editingCampo: null });

    const ctx = makeCtx(userId);
    await handleNlpCancel(ctx);

    expect(state.pendingNlpMovimientos.has(userId)).toBe(false);
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining('Cancelado'));
  });
});

// ── handleNlpEdit ─────────────────────────────────────────────────────────────

describe('handleNlpEdit', () => {
  test('muestra botones de campos cuando hay pendiente', async () => {
    const userId = 30;
    state.pendingNlpMovimientos.set(userId, { entities: BASE_ENTITIES, editingCampo: null });

    const ctx = makeCtx(userId);
    await handleNlpEdit(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('campo querés editar'),
      expect.any(Object)
    );
  });

  test('responde que expiró cuando no hay pendiente', async () => {
    const ctx = makeCtx(99);
    await handleNlpEdit(ctx);
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining('expiró'));
  });
});

// ── campo handlers ────────────────────────────────────────────────────────────

describe('campo handlers', () => {
  test('handleNlpEditMonto setea editingCampo=monto', async () => {
    const userId = 40;
    state.pendingNlpMovimientos.set(userId, { entities: BASE_ENTITIES, editingCampo: null });
    const ctx = makeCtx(userId);
    await handleNlpEditMonto(ctx);
    expect(state.pendingNlpMovimientos.get(userId).editingCampo).toBe('monto');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('monto'));
  });

  test('handleNlpEditPaciente setea editingCampo=pacienteNombre', async () => {
    const userId = 41;
    state.pendingNlpMovimientos.set(userId, { entities: BASE_ENTITIES, editingCampo: null });
    const ctx = makeCtx(userId);
    await handleNlpEditPaciente(ctx);
    expect(state.pendingNlpMovimientos.get(userId).editingCampo).toBe('pacienteNombre');
  });

  test('handleNlpEditMetodo setea editingCampo=metodo_pago', async () => {
    const userId = 42;
    state.pendingNlpMovimientos.set(userId, { entities: BASE_ENTITIES, editingCampo: null });
    const ctx = makeCtx(userId);
    await handleNlpEditMetodo(ctx);
    expect(state.pendingNlpMovimientos.get(userId).editingCampo).toBe('metodo_pago');
  });

  test('handleNlpEditTipo setea editingCampo=tipo', async () => {
    const userId = 43;
    state.pendingNlpMovimientos.set(userId, { entities: BASE_ENTITIES, editingCampo: null });
    const ctx = makeCtx(userId);
    await handleNlpEditTipo(ctx);
    expect(state.pendingNlpMovimientos.get(userId).editingCampo).toBe('tipo');
  });

  test('handleNlpEditEstado setea editingCampo=estado', async () => {
    const userId = 44;
    state.pendingNlpMovimientos.set(userId, { entities: BASE_ENTITIES, editingCampo: null });
    const ctx = makeCtx(userId);
    await handleNlpEditEstado(ctx);
    expect(state.pendingNlpMovimientos.get(userId).editingCampo).toBe('estado');
  });

  test('handleNlpEditReescribir elimina el pendiente', async () => {
    const userId = 45;
    state.pendingNlpMovimientos.set(userId, { entities: BASE_ENTITIES, editingCampo: null });
    const ctx = makeCtx(userId);
    await handleNlpEditReescribir(ctx);
    expect(state.pendingNlpMovimientos.has(userId)).toBe(false);
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining('Movimiento descartado'));
  });
});

// ── actualizarCampoNlp ────────────────────────────────────────────────────────

describe('actualizarCampoNlp', () => {
  function makePending(campo) {
    return { entities: { ...BASE_ENTITIES }, editingCampo: campo };
  }

  test('actualiza monto y muestra confirmación', async () => {
    const userId = 50;
    const pending = makePending('monto');
    const ctx = makeCtx(userId);
    await actualizarCampoNlp(ctx, userId, pending, '20000');
    expect(state.pendingNlpMovimientos.get(userId).entities.monto).toBe(20000);
    expect(state.pendingNlpMovimientos.get(userId).editingCampo).toBeNull();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('¿Es correcto?'), expect.any(Object));
  });

  test('rechaza monto inválido', async () => {
    const ctx = makeCtx(51);
    const pending = makePending('monto');
    await actualizarCampoNlp(ctx, 51, pending, 'abc');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Monto inválido'));
    expect(state.pendingNlpMovimientos.has(51)).toBe(false);
  });

  test('actualiza pacienteNombre', async () => {
    const userId = 52;
    const pending = makePending('pacienteNombre');
    const ctx = makeCtx(userId);
    await actualizarCampoNlp(ctx, userId, pending, 'María García');
    expect(state.pendingNlpMovimientos.get(userId).entities.pacienteNombre).toBe('María García');
  });

  test('actualiza metodo_pago válido', async () => {
    const userId = 53;
    const pending = makePending('metodo_pago');
    const ctx = makeCtx(userId);
    await actualizarCampoNlp(ctx, userId, pending, 'transferencia');
    expect(state.pendingNlpMovimientos.get(userId).entities.metodo_pago).toBe('transferencia');
  });

  test('rechaza metodo_pago inválido', async () => {
    const ctx = makeCtx(54);
    await actualizarCampoNlp(ctx, 54, makePending('metodo_pago'), 'cheque');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Método inválido'));
  });

  test('actualiza tipo a gasto', async () => {
    const userId = 55;
    const pending = makePending('tipo');
    const ctx = makeCtx(userId);
    await actualizarCampoNlp(ctx, userId, pending, 'gasto');
    expect(state.pendingNlpMovimientos.get(userId).entities.tipo).toBe('gasto');
  });

  test('rechaza tipo inválido', async () => {
    const ctx = makeCtx(56);
    await actualizarCampoNlp(ctx, 56, makePending('tipo'), 'otro');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Tipo inválido'));
  });

  test('actualiza estado a Pendiente', async () => {
    const userId = 57;
    const pending = makePending('estado');
    const ctx = makeCtx(userId);
    await actualizarCampoNlp(ctx, userId, pending, 'pendiente');
    expect(state.pendingNlpMovimientos.get(userId).entities.estado).toBe('Pendiente');
  });

  test('rechaza estado inválido', async () => {
    const ctx = makeCtx(58);
    await actualizarCampoNlp(ctx, 58, makePending('estado'), 'tal vez');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Estado inválido'));
  });
});

// ── discard flow ──────────────────────────────────────────────────────────────

describe('handleNlpKeepOld / handleNlpDiscardOld', () => {
  test('handleNlpKeepOld re-muestra la confirmación', async () => {
    const userId = 60;
    state.pendingNlpMovimientos.set(userId, { entities: BASE_ENTITIES, editingCampo: null });
    const ctx = makeCtx(userId);
    await handleNlpKeepOld(ctx);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('¿Es correcto?'),
      expect.any(Object)
    );
  });

  test('handleNlpDiscardOld elimina el pendiente', async () => {
    const userId = 61;
    state.pendingNlpMovimientos.set(userId, { entities: BASE_ENTITIES, editingCampo: null });
    const ctx = makeCtx(userId);
    await handleNlpDiscardOld(ctx);
    expect(state.pendingNlpMovimientos.has(userId)).toBe(false);
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining('descartado'));
  });
});
