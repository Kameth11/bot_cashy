// Ítem 3.5(a): al tocar "📆 Otra fecha" en el picker de agenda, el bot pasa a
// esperar la fecha como texto libre (DD/MM o DD/MM/AAAA). Este archivo prueba
// ese tramo del flujo en handlers/text.js: rechazo de fecha inválida y, con
// una válida, que dispara el guardado (vía procesarFechaAgendaElegida).

jest.mock('../src/lib/telegraf', () => ({
  bot: {
    on: (event, handler) => { global.__textHandlers[event] = handler; },
    command: jest.fn(), use: jest.fn(), hears: jest.fn(), action: jest.fn(), catch: jest.fn(),
  },
}));

jest.mock('../src/config', () => ({
  METODOS_VALIDOS: ['efectivo', 'transferencia', 'tarjeta'],
  COMANDOS_INGRESO: ['consulta', 'servicio'],
  COMANDOS_EGRESO: ['gasto'],
  MAX_TEXT_LENGTH: 1000,
  MAX_DESCRIPCION_LENGTH: 120,
  MAX_MOVIMIENTO_MONTO: 1000000000,
  MAX_COTIZACION_DOLAR: 100000,
  AUTHORIZED_USER_ID: 1111,
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  DASHBOARD_URL: null,
}));

jest.mock('../src/services/cliente.service', () => ({
  get clientes() { return { '5000': { sheetId: 'sheet-5000', usuarios: [] } }; },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

jest.mock('../src/services/command.service', () => ({ guardarMovimiento: jest.fn() }));
jest.mock('../src/services/quick_nlp.service', () => ({ quickParse: jest.fn() }));
jest.mock('../src/services/gemini.service', () => ({ canAttemptRemoteNlp: jest.fn(() => false), parseMessage: jest.fn() }));
jest.mock('../src/services/openrouter.service', () => ({ canAttemptFullIA: jest.fn(() => false), parseMessage: jest.fn() }));
jest.mock('../src/handlers/nlp', () => ({ handleNLPIntent: jest.fn() }));
jest.mock('../src/handlers/nlp-confirm', () => ({
  actualizarCampoNlp: jest.fn(), crearMensajeConfirmacion: jest.fn(), discardButtons: jest.fn(),
}));
jest.mock('../src/handlers/commands/salir', () => ({ procesarConfirmacionSalir: jest.fn() }));
jest.mock('../src/services/registration.service', () => ({ handlePendingRegistration: jest.fn() }));

jest.mock('../src/lib/google', () => ({ GoogleSpreadsheet: jest.fn(), serviceAccountAuth: {} }));
jest.mock('../src/services/sheet.service', () => ({ invalidateCache: jest.fn() }));
jest.mock('../src/services/movimiento.service', () => ({ convertirAPesos: jest.fn() }));
jest.mock('../src/services/cotizacion.service', () => ({ obtenerCotizacionDolar: jest.fn() }));
jest.mock('../src/services/sheet-format.service', () => ({ aplicarColorMontoEnFila: jest.fn() }));
jest.mock('../src/lib/write-queue', () => ({ withUserWriteLock: jest.fn((_, fn) => fn()) }));

const mockDetectarDuplicados = jest.fn().mockResolvedValue([]);
const mockGuardarAgendaParaFecha = jest.fn().mockResolvedValue({ guardados: 1, total: 1, fechaStr: '25/09/2026' });
jest.mock('../src/services/agenda.service', () => ({
  detectarDuplicados: (...args) => mockDetectarDuplicados(...args),
  guardarAgendaParaFecha: (...args) => mockGuardarAgendaParaFecha(...args),
}));

global.__textHandlers = {};
const state = require('../src/state');
require('../src/handlers/text');

function ctxFor(userId, text) {
  return { from: { id: userId }, message: { text }, reply: jest.fn().mockResolvedValue(true) };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.processingNlp.clear();
  state.pendingAgendaFecha.clear();
});

test('con los botones (no en modo texto), cualquier texto libre pide usar los botones', async () => {
  state.pendingAgendaFecha.set(5000, { turnos: [{ hora: '10:00', cliente: 'Juan' }] });
  const ctx = ctxFor(5000, 'hola');

  await global.__textHandlers.text(ctx);

  expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('confirmación pendiente'));
  expect(mockGuardarAgendaParaFecha).not.toHaveBeenCalled();
});

test('en modo "esperando fecha", rechaza texto que no es una fecha válida', async () => {
  state.pendingAgendaFecha.set(5000, { turnos: [{ hora: '10:00', cliente: 'Juan' }], esperandoTexto: true });
  const ctx = ctxFor(5000, 'no es una fecha');

  await global.__textHandlers.text(ctx);

  expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('inválida'));
  expect(mockGuardarAgendaParaFecha).not.toHaveBeenCalled();
  // Se mantiene esperando: no se borra el estado ante una fecha inválida.
  expect(state.pendingAgendaFecha.has(5000)).toBe(true);
});

test('en modo "esperando fecha", una fecha DD/MM válida dispara el guardado', async () => {
  state.pendingAgendaFecha.set(5000, { turnos: [{ hora: '10:00', cliente: 'Juan' }], esperandoTexto: true });
  const ctx = ctxFor(5000, '25/09');

  await global.__textHandlers.text(ctx);

  expect(mockDetectarDuplicados).toHaveBeenCalledWith(5000, [{ hora: '10:00', cliente: 'Juan' }], expect.stringMatching(/^25\/09\/\d{4}$/));
  expect(mockGuardarAgendaParaFecha).toHaveBeenCalled();
  expect(state.pendingAgendaFecha.has(5000)).toBe(false);
});
