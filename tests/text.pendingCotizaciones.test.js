// Ítem 2.5: cuando el usuario tipeaba a mano la cotización del dólar para un
// movimiento (state.pendingCotizaciones), el valor se usaba bien para ESE
// movimiento (cotizacionUsada) pero además pisaba state.cotizacionDolar —
// la cotización GLOBAL, compartida por todos los consultorios y llenada por
// obtenerCotizacionDolar() desde Bluelytics. Un valor tipeado por un usuario
// para su propia carga terminaba siendo la referencia de conversión para
// todo el mundo hasta el próximo fetch automático (cada 3h).

jest.mock('../src/lib/telegraf', () => ({
  bot: {
    on: (event, handler) => { global.__cotizHandlers[event] = handler; },
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
  get clientes() {
    return {
      '5000': { sheetId: 'sheet-5000', usuarios: [] },
      '6000': { sheetId: 'sheet-6000', usuarios: [] },
    };
  },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

jest.mock('../src/services/command.service', () => ({
  guardarMovimiento: jest.fn().mockResolvedValue({ mensaje: 'ok' }),
}));

jest.mock('../src/services/quick_nlp.service', () => ({ quickParse: jest.fn() }));
jest.mock('../src/services/gemini.service', () => ({ canAttemptRemoteNlp: jest.fn(() => false), parseMessage: jest.fn() }));
jest.mock('../src/services/openrouter.service', () => ({ canAttemptFullIA: jest.fn(() => false), parseMessage: jest.fn() }));
jest.mock('../src/handlers/nlp', () => ({ handleNLPIntent: jest.fn() }));
jest.mock('../src/handlers/nlp-confirm', () => ({
  actualizarCampoNlp: jest.fn(), crearMensajeConfirmacion: jest.fn(), discardButtons: jest.fn(),
}));
jest.mock('../src/handlers/commands/salir', () => ({ procesarConfirmacionSalir: jest.fn() }));
jest.mock('../src/services/registration.service', () => ({ handlePendingRegistration: jest.fn() }));

global.__cotizHandlers = {};

const state = require('../src/state');
const cmd = require('../src/services/command.service');
require('../src/handlers/text');

function ctxFor(userId, text) {
  return { from: { id: userId }, message: { text }, reply: jest.fn().mockResolvedValue(true) };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.processingNlp.clear();
  state.pendingCotizaciones.clear();
  state.pendingPayments.clear();
  state.cotizacionDolar = null;
  state.cotizacionFecha = null;
});

describe('pendingCotizaciones — el valor tipeado a mano no pisa la cotización global', () => {
  test('usa la cotización tipeada solo para ese movimiento, sin tocar state.cotizacionDolar', async () => {
    state.cotizacionDolar = 1100; // cotización global "oficial" ya cargada
    state.pendingCotizaciones.set(5000, {
      descripcion: 'Juan Perez', monto: 50, tipo: 'Ingreso', moneda: 'Dólares',
      metodoIndicado: 'efectivo', estado: 'Cobrado',
    });

    const ctx = ctxFor(5000, '1500');
    await global.__cotizHandlers.text(ctx);

    expect(cmd.guardarMovimiento).toHaveBeenCalledWith(
      5000,
      expect.objectContaining({ descripcion: 'Juan Perez', monto: 50 }),
      expect.objectContaining({ cotizacionUsada: 1500 })
    );
    // La cotización global NO cambió: sigue siendo la que ya estaba.
    expect(state.cotizacionDolar).toBe(1100);
  });

  test('también se respeta cuando no había ninguna cotización global cargada todavía', async () => {
    state.cotizacionDolar = null;
    state.pendingCotizaciones.set(6000, {
      descripcion: 'Endodoncia', monto: 80, tipo: 'Ingreso', moneda: 'Dólares',
      metodoIndicado: 'transferencia', estado: 'Cobrado',
    });

    const ctx = ctxFor(6000, '1300');
    await global.__cotizHandlers.text(ctx);

    expect(cmd.guardarMovimiento).toHaveBeenCalledWith(
      6000,
      expect.anything(),
      expect.objectContaining({ cotizacionUsada: 1300 })
    );
    expect(state.cotizacionDolar).toBeNull();
  });
});
