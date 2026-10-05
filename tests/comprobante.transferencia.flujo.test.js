// Flujo de una foto de transferencia: leer -> buscar pendientes -> elegir.

global.__acts = {};
jest.mock('../src/lib/telegraf', () => ({
  bot: { action: (n, h) => { global.__acts[n instanceof RegExp ? n.source : n] = { n, h }; }, on: jest.fn(), command: jest.fn(), use: jest.fn(), hears: jest.fn(), catch: jest.fn() },
}));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/lib/semaphore', () => ({ geminiMediaSemaphore: { run: (fn) => fn() } }));
jest.mock('../src/services/comprobante-vision.service', () => ({ extraerTransferencia: jest.fn(), extraerFactura: jest.fn() }));
jest.mock('../src/services/comprobante.service', () => ({
  ...jest.requireActual('../src/services/comprobante.service'),
  buscarDuplicado: jest.fn().mockResolvedValue(null),
  registrarComprobante: jest.fn().mockResolvedValue('ok'),
}));
jest.mock('../src/services/command.service', () => ({
  buscarPendientesDePagador: jest.fn(),
  ejecutarCobrarFila: jest.fn().mockResolvedValue('✅ cobrado'),
}));
jest.mock('../src/handlers/nlp-confirm', () => ({ mostrarConfirmacion: jest.fn().mockResolvedValue(true) }));
jest.mock('../src/handlers/text', () => ({
  marcarAmbito: jest.fn(async (userId, texto, result) => ({ ...result, entities: { ...result.entities, ambito: 'consultorio' } })),
}));

const state = require('../src/state');
const vision = require('../src/services/comprobante-vision.service');
const cmd = require('../src/services/command.service');
const compService = require('../src/services/comprobante.service');
const { mostrarConfirmacion } = require('../src/handlers/nlp-confirm');
const { procesarTransferencia } = require('../src/handlers/comprobante');

const archivo = { buffer: Buffer.from('x'), mimeType: 'image/jpeg', fileId: 'F1' };
const T = { pagador: 'Juan Perez', monto: 30000, moneda: 'Pesos', fecha: '30/09/2026', cuitPagador: null, numeroOperacion: '77', banco: 'MP' };
const ctxBase = () => ({ from: { id: 1 }, reply: jest.fn().mockResolvedValue(true), editMessageText: jest.fn().mockResolvedValue(true), answerCbQuery: jest.fn().mockResolvedValue(true) });
const fila = (monto) => ({ get: (k) => ({ Monto: monto, Moneda: 'Pesos', Descripcion: 'Consulta Juan', ID_Unico: 'mov1', MetodoPago: '' })[k], set: jest.fn() });

beforeEach(() => { jest.clearAllMocks(); state.pendingTransferencias.clear(); vision.extraerTransferencia.mockResolvedValue({ transferencia: T }); });

test('sin pendientes del pagador: va directo a la confirmación de ingreso nuevo', async () => {
  cmd.buscarPendientesDePagador.mockResolvedValue([]);
  await procesarTransferencia(ctxBase(), archivo);
  expect(mostrarConfirmacion).toHaveBeenCalledTimes(1);
  const e = mostrarConfirmacion.mock.calls[0][1];
  expect(e).toMatchObject({ tipo: 'ingreso', monto: 30000, metodo_pago: 'transferencia', estado: 'Cobrado', pacienteNombre: 'Juan Perez' });
  expect(e.comprobante.archivo).toBe('tg:F1');
});

test('con pendientes: ofrece botones y guarda el estado; NO cobra solo', async () => {
  cmd.buscarPendientesDePagador.mockResolvedValue([fila(-0 + 30000)]);
  const ctx = ctxBase();
  await procesarTransferencia(ctx, archivo);
  expect(cmd.ejecutarCobrarFila).not.toHaveBeenCalled();
  expect(mostrarConfirmacion).not.toHaveBeenCalled();
  expect(ctx.reply.mock.calls[0][0]).toMatch(/Transferencia leída/);
  expect(state.pendingTransferencias.has(1)).toBe(true);
});

test('cobro total: marca método transferencia, cobra y registra el comprobante', async () => {
  const f = fila(30000);
  cmd.buscarPendientesDePagador.mockResolvedValue([f]);
  await procesarTransferencia(ctxBase(), archivo);

  const ctx = { ...ctxBase(), match: ['transf_cobrar_0', '0'] };
  await global.__acts['^transf_cobrar_(\\d+)$'].h(ctx);
  expect(f.set).toHaveBeenCalledWith('MetodoPago', 'transferencia');
  expect(cmd.ejecutarCobrarFila).toHaveBeenCalledWith(1, f, null);
  expect(compService.registrarComprobante).toHaveBeenCalledWith(1, expect.objectContaining({ tipo: 'transferencia', idMovimiento: 'mov1', total: 30000 }));
  expect(state.pendingTransferencias.has(1)).toBe(false);
});

test('cobro parcial (transferencia menor al saldo): cobra solo el monto y no toca el método', async () => {
  const f = fila(50000);
  cmd.buscarPendientesDePagador.mockResolvedValue([f]);
  await procesarTransferencia(ctxBase(), archivo);
  await global.__acts['^transf_cobrar_(\\d+)$'].h({ ...ctxBase(), match: ['x', '0'] });
  expect(cmd.ejecutarCobrarFila).toHaveBeenCalledWith(1, f, 30000);
  expect(f.set).not.toHaveBeenCalled();
});

test('transferencia mayor al pendiente: cobra el total y avisa el sobrante', async () => {
  const f = fila(20000);
  cmd.buscarPendientesDePagador.mockResolvedValue([f]);
  await procesarTransferencia(ctxBase(), archivo);
  const ctx = { ...ctxBase(), match: ['x', '0'] };
  await global.__acts['^transf_cobrar_(\\d+)$'].h(ctx);
  expect(cmd.ejecutarCobrarFila).toHaveBeenCalledWith(1, f, null);
  expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/mayor al pendiente/);
});

test('"ingreso nuevo" y "cancelar"', async () => {
  cmd.buscarPendientesDePagador.mockResolvedValue([fila(30000)]);
  await procesarTransferencia(ctxBase(), archivo);
  await global.__acts.transf_nuevo.h(ctxBase());
  expect(mostrarConfirmacion).toHaveBeenCalledTimes(1);
  expect(state.pendingTransferencias.has(1)).toBe(false);

  await procesarTransferencia(ctxBase(), archivo);
  const ctx = ctxBase();
  await global.__acts.transf_cancel.h(ctx);
  expect(ctx.editMessageText).toHaveBeenCalledWith('❌ Cancelado.');
  expect(state.pendingTransferencias.has(1)).toBe(false);
  expect(cmd.ejecutarCobrarFila).not.toHaveBeenCalled();
});

test('errores de lectura: mensajes claros y sin estado colgado', async () => {
  const ctx1 = ctxBase();
  vision.extraerTransferencia.mockResolvedValue({ error: 'no_es_transferencia' });
  vision.extraerFactura.mockResolvedValue({ error: 'no_es_comprobante' });
  await procesarTransferencia(ctx1, archivo);
  expect(ctx1.reply.mock.calls[0][0]).toMatch(/ni una factura/);

  const ctx2 = ctxBase();
  vision.extraerTransferencia.mockResolvedValue({ transferencia: { ...T, monto: null } });
  await procesarTransferencia(ctx2, archivo);
  expect(ctx2.reply.mock.calls[0][0]).toMatch(/no encontré el monto/);
  expect(state.pendingTransferencias.size).toBe(0);
});

test('sesión vencida en un botón: avisa', async () => {
  const ctx = { ...ctxBase(), match: ['x', '0'] };
  await global.__acts['^transf_cobrar_(\\d+)$'].h(ctx);
  expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/Sesión expirada/);
});

test('"transferencia" que en realidad es un pago a un servicio: se lee como factura (gasto de servicios)', async () => {
  vision.extraerTransferencia.mockResolvedValue({ error: 'no_es_transferencia' });
  vision.extraerFactura.mockResolvedValue({
    factura: {
      tipoDocumento: 'boleta_servicio', letra: null, emisor: 'Edenor', cuit: null, numero: null,
      fechaEmision: '01/10/2026', fechaVencimiento: null, total: 45300.5, moneda: 'Pesos',
      metodoPago: 'transferencia', pagado: true, rubro: 'electricidad', descripcion: 'Edenor',
      categoria: 'servicios', items: [],
    },
  });
  const ctx = ctxBase();
  await procesarTransferencia(ctx, archivo);
  expect(vision.extraerFactura).toHaveBeenCalledTimes(1);
  expect(mostrarConfirmacion).toHaveBeenCalledTimes(1);
  const e = mostrarConfirmacion.mock.calls[0][1];
  expect(e).toMatchObject({ tipo: 'gasto', monto: 45300.5, categoria: 'servicios' });
  expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringMatching(/No parece/));
});

// ── Transferencia ENVIADA: es un egreso ──────────────────────────────────────
const ENVIADA = { pagador: 'Matías Dueño', destinatario: 'Pinturería Sur', monto: 18000, moneda: 'Pesos', fecha: '02/10/2026', cuitPagador: null, numeroOperacion: '987', banco: 'MP', concepto: 'pintura', direccion: 'enviada' };

test('transferencia enviada: va a la confirmación como EGRESO, con el destinatario de proveedor', async () => {
  vision.extraerTransferencia.mockResolvedValue({ transferencia: ENVIADA });
  await procesarTransferencia(ctxBase(), archivo);

  expect(mostrarConfirmacion).toHaveBeenCalledTimes(1);
  const e = mostrarConfirmacion.mock.calls[0][1];
  expect(e).toMatchObject({
    tipo: 'gasto', monto: 18000, metodo_pago: 'transferencia', estado: 'Cobrado',
    proveedorNombre: 'Pinturería Sur', pacienteNombre: null, pagadorNombre: null, direccionTransferencia: 'enviada',
  });
  expect(e.comprobante).toMatchObject({ tipo: 'transferencia', emisor: 'Pinturería Sur' });
});

test('transferencia enviada: NO busca pendientes de un paciente ni ofrece cobrar', async () => {
  vision.extraerTransferencia.mockResolvedValue({ transferencia: ENVIADA });
  await procesarTransferencia(ctxBase(), archivo);
  expect(cmd.buscarPendientesDePagador).not.toHaveBeenCalled();
  expect(state.pendingTransferencias.size).toBe(0);
});

test('transferencia enviada: el ámbito se decide con el destinatario y el concepto, y no va a casa', async () => {
  const { marcarAmbito } = require('../src/handlers/text');
  vision.extraerTransferencia.mockResolvedValue({ transferencia: ENVIADA });
  await procesarTransferencia(ctxBase(), archivo);
  expect(marcarAmbito).toHaveBeenCalledWith(1, expect.stringContaining('Pinturería Sur'), expect.objectContaining({ intent: 'registrar_movimiento' }), { permitirCasa: false, personalSoloDueno: true });
});

test('transferencia enviada: el duplicado se busca por el destinatario (no por quien pagó)', async () => {
  vision.extraerTransferencia.mockResolvedValue({ transferencia: ENVIADA });
  await procesarTransferencia(ctxBase(), archivo);
  expect(compService.buscarDuplicado).toHaveBeenCalledWith(1, expect.objectContaining({ emisor: 'Pinturería Sur', numero: '987', total: 18000 }));
});

test('sin dirección clara se mantiene el comportamiento de siempre: ingreso', async () => {
  vision.extraerTransferencia.mockResolvedValue({ transferencia: { ...T, direccion: null } });
  cmd.buscarPendientesDePagador.mockResolvedValue([]);
  await procesarTransferencia(ctxBase(), archivo);
  expect(mostrarConfirmacion.mock.calls[0][1]).toMatchObject({ tipo: 'ingreso', pacienteNombre: 'Juan Perez' });
});
