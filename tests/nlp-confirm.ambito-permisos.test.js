// Ítem 1.2: el botón "🏠 Es personal" de la confirmación NLP no puede dejar
// que un invitado pase un movimiento a ámbito personal (esas pestañas son
// del dueño). marcarAmbito ya evita que la detección automática caiga en
// "personal" para un invitado — este test cubre el otro camino: tocar el
// botón a mano.

jest.mock('../src/lib/telegraf', () => ({ bot: { action: jest.fn(), on: jest.fn() } }));
jest.mock('telegraf', () => ({
  Markup: {
    inlineKeyboard: jest.fn((rows) => ({ reply_markup: { inline_keyboard: rows } })),
    button: { callback: jest.fn((label, id) => ({ text: label, callback_data: id })) },
  },
}));

jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

jest.mock('../src/config', () => ({
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

jest.mock('../src/services/command.service', () => ({ registrarMovimientoDesdeNLP: jest.fn() }));

jest.mock('../src/services/personal.service', () => ({
  obtenerViajeActivo: jest.fn().mockResolvedValue(null),
  correspondeAlViaje: jest.fn().mockReturnValue(false),
  fechaHoyStr: jest.fn().mockReturnValue('2026-01-01'),
  guardarPreferencia: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/personal-nlp.service', () => ({
  inferirCategoriaPersonal: jest.fn().mockReturnValue('combustible'),
}));

const state = require('../src/state');
const personalService = require('../src/services/personal.service');
const { handleNlpToggleAmbito } = require('../src/handlers/nlp-confirm');

function ctxFor(userId) {
  return {
    from: { id: userId },
    answerCbQuery: jest.fn(async () => {}),
    reply: jest.fn(async () => {}),
    editMessageText: jest.fn(async () => {}),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.pendingNlpMovimientos.clear();
});

describe('handleNlpToggleAmbito — pasar a "personal" es solo del dueño', () => {
  test('invitado (3333) intenta tocar "Es personal" → denegado, el movimiento sigue en consultorio', async () => {
    state.pendingNlpMovimientos.set(3333, {
      entities: { tipo: 'egreso', descripcion: 'nafta', monto: 20000, ambito: 'consultorio', terminoAmbito: 'nafta' },
    });
    const ctx = ctxFor(3333);

    await handleNlpToggleAmbito(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('solo para el dueño'));
    expect(state.pendingNlpMovimientos.get(3333).entities.ambito).toBe('consultorio');
    expect(personalService.guardarPreferencia).not.toHaveBeenCalled();
  });

  test('dueño (2222) puede tocar "Es personal"', async () => {
    state.pendingNlpMovimientos.set(2222, {
      entities: { tipo: 'egreso', descripcion: 'nafta', monto: 20000, ambito: 'consultorio', terminoAmbito: 'nafta' },
    });
    const ctx = ctxFor(2222);

    await handleNlpToggleAmbito(ctx);

    expect(state.pendingNlpMovimientos.get(2222).entities.ambito).toBe('personal');
  });

  test('admin (1111) puede tocar "Es personal"', async () => {
    state.pendingNlpMovimientos.set(1111, {
      entities: { tipo: 'egreso', descripcion: 'nafta', monto: 20000, ambito: 'consultorio', terminoAmbito: 'nafta' },
    });
    const ctx = ctxFor(1111);

    await handleNlpToggleAmbito(ctx);

    expect(state.pendingNlpMovimientos.get(1111).entities.ambito).toBe('personal');
  });

  test('cualquier usuario puede volver de "personal" a "consultorio" sin restricción', async () => {
    state.pendingNlpMovimientos.set(3333, {
      entities: { tipo: 'egreso', descripcion: 'nafta', monto: 20000, ambito: 'personal', categoriaConsultorio: null },
    });
    const ctx = ctxFor(3333);

    await handleNlpToggleAmbito(ctx);

    expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringContaining('solo para el dueño'));
    expect(state.pendingNlpMovimientos.get(3333).entities.ambito).toBe('consultorio');
  });
});
