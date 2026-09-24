// Intent nuevo "consulta_agenda": responde en lenguaje natural preguntas
// tipo "qué turnos tengo hoy" combinando obtenerTurnosPorFecha (dato real)
// con gemini.service.generarRespuestaAgenda (redacción). Cubre: con turnos,
// sin turnos (no llama a Gemini), Gemini falla (fallback armado a mano), y
// fecha ambigua (aviso + asume hoy).

jest.mock('../src/lib/telegraf', () => ({ bot: { on: jest.fn(), command: jest.fn(), use: jest.fn(), hears: jest.fn(), action: jest.fn(), catch: jest.fn() } }));

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  DASHBOARD_URL: null,
}));

jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return { '2222': { sheetId: 's', usuarios: [], permisos: {} } }; // owner: todos los permisos
  },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

jest.mock('../src/services/command.service', () => ({
  guardarMovimiento: jest.fn().mockResolvedValue({ mensaje: 'ok' }),
}));
jest.mock('../src/handlers/commands/sheet', () => ({ handleSheetCommand: jest.fn() }));
jest.mock('../src/handlers/actions', () => ({ confirmButtons: jest.fn().mockReturnValue({}) }));
jest.mock('../src/handlers/cobrar-confirm', () => ({ mostrarCobrar: jest.fn() }));
jest.mock('../src/handlers/nlp-confirm', () => ({ mostrarConfirmacion: jest.fn() }));

jest.mock('../src/services/gemini.service', () => ({
  canAttemptRemoteNlp: jest.fn().mockReturnValue(false),
  parseMessage: jest.fn(),
  generarRespuestaAgenda: jest.fn(),
}));

jest.mock('../src/services/agenda.service', () => ({
  obtenerTurnosPorFecha: jest.fn(),
}));

const geminiService = require('../src/services/gemini.service');
const { obtenerTurnosPorFecha } = require('../src/services/agenda.service');
const { handleNLPIntent } = require('../src/handlers/nlp');
const { fechaArgentinaStr, fechaMananaArgentinaStr } = require('../src/utils/date');

function ctxFor(userId) {
  return { from: { id: userId }, reply: jest.fn().mockResolvedValue(true) };
}

const TURNOS = [
  { idTurno: '1', hora: '15:00', cliente: 'María', servicio: 'Control', profesional: 'Diego', estado: 'Confirmado' },
  { idTurno: '2', hora: '10:00', cliente: 'Juan Pérez', servicio: 'Limpieza', profesional: 'Laura', estado: 'Confirmado' },
];

beforeEach(() => jest.clearAllMocks());

describe('consulta_agenda — con turnos', () => {
  test('llama a obtenerTurnosPorFecha con hoy y responde con el texto de Gemini', async () => {
    obtenerTurnosPorFecha.mockResolvedValue(TURNOS);
    geminiService.generarRespuestaAgenda.mockResolvedValue('Hoy tenés turno con Juan Pérez a las 10 y con María a las 15.');

    const ctx = ctxFor(2222);
    await handleNLPIntent(ctx, { intent: 'consulta_agenda', entities: { fecha_ref: null } }, '¿qué turnos tengo hoy?');

    expect(obtenerTurnosPorFecha).toHaveBeenCalledWith(2222, fechaArgentinaStr());
    expect(geminiService.generarRespuestaAgenda).toHaveBeenCalledWith('¿qué turnos tengo hoy?', TURNOS);
    expect(ctx.reply).toHaveBeenCalledWith('Hoy tenés turno con Juan Pérez a las 10 y con María a las 15.');
  });

  test('resuelve "mañana" a la fecha correcta', async () => {
    obtenerTurnosPorFecha.mockResolvedValue(TURNOS);
    geminiService.generarRespuestaAgenda.mockResolvedValue('Mañana tenés dos turnos.');

    const ctx = ctxFor(2222);
    await handleNLPIntent(ctx, { intent: 'consulta_agenda', entities: { fecha_ref: 'mañana' } }, '¿tengo algo mañana?');

    expect(obtenerTurnosPorFecha).toHaveBeenCalledWith(2222, fechaMananaArgentinaStr());
  });

  test('si Gemini falla/devuelve null, cae a una lista armada a mano (sin llamar a ctx.reply dos veces)', async () => {
    obtenerTurnosPorFecha.mockResolvedValue(TURNOS);
    geminiService.generarRespuestaAgenda.mockResolvedValue(null);

    const ctx = ctxFor(2222);
    await handleNLPIntent(ctx, { intent: 'consulta_agenda', entities: {} }, 'agenda de hoy');

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [mensaje] = ctx.reply.mock.calls[0];
    expect(mensaje).toContain('10:00 — Juan Pérez');
    expect(mensaje).toContain('15:00 — María');
  });
});

describe('consulta_agenda — sin turnos', () => {
  test('no llama a Gemini cuando no hay turnos, responde mensaje fijo', async () => {
    obtenerTurnosPorFecha.mockResolvedValue([]);

    const ctx = ctxFor(2222);
    await handleNLPIntent(ctx, { intent: 'consulta_agenda', entities: {} }, '¿qué turnos tengo hoy?');

    expect(geminiService.generarRespuestaAgenda).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No tenés turnos cargados'));
  });
});

describe('consulta_agenda — fecha ambigua', () => {
  test('fecha_ref no reconocida: avisa y asume hoy igual', async () => {
    obtenerTurnosPorFecha.mockResolvedValue(TURNOS);
    geminiService.generarRespuestaAgenda.mockResolvedValue('Hoy tenés dos turnos.');

    const ctx = ctxFor(2222);
    await handleNLPIntent(ctx, { intent: 'consulta_agenda', entities: { fecha_ref: 'el lunes' } }, '¿qué tengo el lunes?');

    expect(obtenerTurnosPorFecha).toHaveBeenCalledWith(2222, fechaArgentinaStr());
    const [mensaje] = ctx.reply.mock.calls[0];
    expect(mensaje).toContain('No entendí bien qué día pedías');
  });
});
