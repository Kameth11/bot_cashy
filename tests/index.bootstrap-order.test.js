// Ítem 2.3: clientes.json/Supabase se cargaban de forma asíncrona SIN
// esperar a que terminara antes de bot.launch()/startApi(). En los primeros
// segundos del proceso, cualquier mensaje o request llegaba con
// `clienteService.clientes` todavía vacío, así que hasta el dueño real
// parecía "no autorizado". Este test verifica que iniciar() (src/index.js)
// espera clienteService.listo antes de arrancar el bot y la API.

jest.mock('../src/lib/telegraf', () => ({
  bot: {
    command: jest.fn(), on: jest.fn(), use: jest.fn(), action: jest.fn(), catch: jest.fn(),
    launch: jest.fn(() => new Promise(() => {})), // nunca resuelve: no nos interesa lo que pasa después
    stop: jest.fn(),
  },
}));

jest.mock('../src/api', () => ({
  startApi: jest.fn().mockResolvedValue({ close: jest.fn() }),
}));

jest.mock('../src/services/cotizacion.service', () => ({
  obtenerCotizacionDolar: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/gemini.service', () => ({
  initModel: jest.fn(),
  canAttemptRemoteNlp: jest.fn(() => false),
  parseMessage: jest.fn(),
  transcribirAudio: jest.fn(),
}));

jest.mock('../src/services/tenant-request.service', () => ({
  seedApprovedEmails: jest.fn().mockResolvedValue(undefined),
  registrarInvitacionAprobada: jest.fn().mockResolvedValue({ ok: true }),
  buscarSolicitudAprobadaPorTelegramId: jest.fn().mockResolvedValue(null),
  buscarSolicitudPorEmail: jest.fn().mockResolvedValue(null),
  crearSolicitud: jest.fn(),
  aprobarSolicitud: jest.fn(),
  rechazarSolicitud: jest.fn(),
  listarSolicitudesPendientes: jest.fn().mockResolvedValue([]),
}));

let mockListoResolve;
const mockListo = new Promise(resolve => { mockListoResolve = resolve; });
jest.mock('../src/services/cliente.service', () => ({
  get clientes() { return {}; },
  listo: mockListo,
  cargarClientes: jest.fn().mockResolvedValue({}),
  guardarClientes: jest.fn().mockResolvedValue(undefined),
  getCliente: jest.fn(),
  eliminarCliente: jest.fn(),
  setModoFullIA: jest.fn(),
  getPermisos: jest.fn(),
  setPermisos: jest.fn(),
}));

const { startApi } = require('../src/api');
const { bot } = require('../src/lib/telegraf');
const { iniciar } = require('../src/index');

describe('iniciar() — bot y API esperan a que termine de cargar clientes', () => {
  test('no llama a startApi() ni bot.launch() mientras clienteService.listo sigue pendiente', async () => {
    const p = iniciar();
    // Dejamos correr microtasks pendientes sin resolver `listo` todavía.
    await Promise.resolve();
    await Promise.resolve();

    expect(startApi).not.toHaveBeenCalled();
    expect(bot.launch).not.toHaveBeenCalled();

    mockListoResolve();
    await p;

    expect(startApi).toHaveBeenCalled();
    expect(bot.launch).toHaveBeenCalled();
  });
});
