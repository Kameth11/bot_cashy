// Ítem 1.1: foto de agenda requiere editar_agenda, nota de voz requiere
// cargar_movimientos. El chequeo se hace ANTES de gastar cuota de Gemini
// (axios.get / transcribirAudio no deberían llamarse si el permiso falta).

jest.mock('axios', () => ({ get: jest.fn() }));

jest.mock('../src/lib/telegraf', () => ({
  bot: { on: (event, handler) => { global.__mediaHandlers[event] = handler; }, command: jest.fn(), use: jest.fn(), hears: jest.fn(), action: jest.fn(), catch: jest.fn() },
}));

jest.mock('../src/lib/logger', () => ({
  audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  MAX_PHOTO_SIZE_BYTES: 10 * 1024 * 1024,
  MAX_TURNOS_POR_IMAGEN: 120,
  MAX_VOICE_SIZE_BYTES: 5 * 1024 * 1024,
  MAX_VOICE_DURATION_SECONDS: 120,
}));

jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': {
        email: 'owner@test.com',
        sheetId: 'sheet-owner',
        usuarios: [3333, 4444],
        permisos: {
          '3333': ['ver_agenda'], // sin editar_agenda ni cargar_movimientos
          '4444': ['ver_agenda', 'editar_agenda', 'ver_movimientos', 'cargar_movimientos', 'editar_movimientos', 'ver_balance'],
        },
      },
    };
  },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

jest.mock('../src/services/vision.service', () => ({
  procesarFotoAgenda: jest.fn().mockResolvedValue({ turnos: [{ hora: '10:00', cliente: 'Juan' }] }),
}));

jest.mock('../src/services/agenda.service', () => ({
  resolverProfesional: jest.fn().mockReturnValue(null),
}));

jest.mock('../src/services/gemini.service', () => ({
  transcribirAudio: jest.fn().mockResolvedValue('consulta Juan $1000 efectivo'),
}));

jest.mock('../src/handlers/actions', () => ({
  confirmButtons: jest.fn().mockReturnValue({}),
}));

// No es lo que este archivo testea; sin esto, un pendingAgendaConfirm que
// deja /foto para el mismo userId bloquearía el test de /voice siguiente.
jest.mock('../src/handlers/guards', () => ({
  tieneProcesoPendiente: jest.fn().mockReturnValue(false),
}));

jest.mock('../src/handlers/text', () => ({
  procesarTextoConNlp: jest.fn().mockResolvedValue(undefined),
}));

global.__mediaHandlers = {};
const handlers = global.__mediaHandlers;

const axios = require('axios');
const { procesarFotoAgenda } = require('../src/services/vision.service');
const geminiService = require('../src/services/gemini.service');
const { procesarTextoConNlp } = require('../src/handlers/text');

require('../src/handlers/photo');
require('../src/handlers/voice');

function ctxFor(userId) {
  return {
    from: { id: userId },
    message: {
      photo: [{ file_id: 'f1', file_size: 1000 }],
      voice: { file_id: 'v1', file_size: 1000, duration: 5 },
    },
    telegram: { getFileLink: jest.fn().mockResolvedValue({ href: 'http://fake/file' }) },
    reply: jest.fn().mockResolvedValue(true),
  };
}

const DENEGADO = expect.stringContaining('No tenés permiso');

beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockResolvedValue({ data: Buffer.from('fake') });
});

describe('foto de agenda requiere editar_agenda', () => {
  test('invitado solo-agenda (3333, sin editar_agenda) → denegado antes de llamar a Gemini Vision', async () => {
    const ctx = ctxFor(3333);
    await handlers.photo(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
    expect(axios.get).not.toHaveBeenCalled();
    expect(procesarFotoAgenda).not.toHaveBeenCalled();
  });

  test('invitado recepción (4444, tiene editar_agenda) → puede mandar la foto', async () => {
    const ctx = ctxFor(4444);
    await handlers.photo(ctx);
    expect(procesarFotoAgenda).toHaveBeenCalled();
  });
});

describe('nota de voz requiere cargar_movimientos', () => {
  test('invitado solo-agenda (3333, sin cargar_movimientos) → denegado antes de transcribir', async () => {
    const ctx = ctxFor(3333);
    await handlers.voice(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
    expect(axios.get).not.toHaveBeenCalled();
    expect(geminiService.transcribirAudio).not.toHaveBeenCalled();
    expect(procesarTextoConNlp).not.toHaveBeenCalled();
  });

  test('invitado recepción (4444, tiene cargar_movimientos) → puede mandar audio', async () => {
    const ctx = ctxFor(4444);
    await handlers.voice(ctx);
    expect(geminiService.transcribirAudio).toHaveBeenCalled();
    expect(procesarTextoConNlp).toHaveBeenCalledWith(ctx, 'consulta Juan $1000 efectivo');
  });
});
