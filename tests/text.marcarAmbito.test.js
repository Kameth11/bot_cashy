// Ítem 1.2: las finanzas personales son las del dueño. Si un invitado
// escribe algo que el detector de ámbito (personal-nlp.service) interpreta
// como "personal" (ej. "nafta 20000"), marcarAmbito (src/handlers/text.js)
// tiene que forzarlo a "consultorio" en vez de dejarlo tocar las pestañas
// personales del dueño. Para el dueño/admin, el ámbito detectado se respeta.

jest.mock('../src/lib/telegraf', () => ({
  bot: { on: jest.fn(), command: jest.fn(), use: jest.fn(), hears: jest.fn(), action: jest.fn(), catch: jest.fn() },
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
      '2222': {
        email: 'owner@test.com',
        sheetId: 'sheet-owner',
        usuarios: [3333],
        permisos: { '3333': ['ver_agenda', 'ver_movimientos', 'cargar_movimientos'] },
      },
    };
  },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

jest.mock('../src/services/quick_nlp.service', () => ({
  quickParse: jest.fn().mockReturnValue({
    intent: 'registrar_movimiento',
    entities: { tipo: 'egreso', descripcion: 'nafta', monto: 20000 },
  }),
}));

jest.mock('../src/services/gemini.service', () => ({
  canAttemptRemoteNlp: jest.fn().mockReturnValue(false),
  parseMessage: jest.fn(),
}));
jest.mock('../src/services/openrouter.service', () => ({
  canAttemptFullIA: jest.fn().mockReturnValue(false),
  parseMessage: jest.fn(),
}));

jest.mock('../src/handlers/nlp', () => ({ handleNLPIntent: jest.fn().mockResolvedValue(true) }));
jest.mock('../src/handlers/nlp-confirm', () => ({
  actualizarCampoNlp: jest.fn(), crearMensajeConfirmacion: jest.fn(), discardButtons: jest.fn(),
}));
jest.mock('../src/handlers/commands/salir', () => ({ procesarConfirmacionSalir: jest.fn() }));
jest.mock('../src/services/registration.service', () => ({ handlePendingRegistration: jest.fn() }));

jest.mock('../src/services/personal.service', () => ({
  leerPreferencias: jest.fn().mockResolvedValue({}),
  obtenerViajeActivo: jest.fn().mockResolvedValue(null),
  correspondeAlViaje: jest.fn().mockReturnValue(false),
  fechaHoyStr: jest.fn().mockReturnValue('2026-01-01'),
}));

jest.mock('../src/services/personal-nlp.service', () => ({
  // Simula que el detector interpreta "nafta" como personal.
  resolverAmbito: jest.fn().mockReturnValue({ ambito: 'personal', ambiguo: false, termino: 'nafta' }),
  inferirCategoriaPersonal: jest.fn().mockReturnValue('combustible'),
}));

const { handleNLPIntent } = require('../src/handlers/nlp');
const { resolverAmbito } = require('../src/services/personal-nlp.service');
const state = require('../src/state');
const { procesarTextoConNlp } = require('../src/handlers/text');

function ctxFor(userId) {
  return { from: { id: userId }, reply: jest.fn().mockResolvedValue(true) };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.processingNlp.clear();
});

describe('marcarAmbito — el ámbito personal es solo del dueño', () => {
  test('invitado (3333): "nafta 20000" se fuerza a ámbito consultorio, sin consultar resolverAmbito', async () => {
    await procesarTextoConNlp(ctxFor(3333), 'nafta 20000');

    expect(handleNLPIntent).toHaveBeenCalledTimes(1);
    const entities = handleNLPIntent.mock.calls[0][1].entities;
    expect(entities.ambito).toBe('consultorio');
    expect(resolverAmbito).not.toHaveBeenCalled();
  });

  test('dueño (2222): mismo mensaje respeta el ámbito personal detectado', async () => {
    await procesarTextoConNlp(ctxFor(2222), 'nafta 20000');

    expect(resolverAmbito).toHaveBeenCalled();
    const entities = handleNLPIntent.mock.calls[0][1].entities;
    expect(entities.ambito).toBe('personal');
  });

  test('admin (1111): mismo mensaje respeta el ámbito personal detectado', async () => {
    await procesarTextoConNlp(ctxFor(1111), 'nafta 20000');

    expect(resolverAmbito).toHaveBeenCalled();
    const entities = handleNLPIntent.mock.calls[0][1].entities;
    expect(entities.ambito).toBe('personal');
  });
});
