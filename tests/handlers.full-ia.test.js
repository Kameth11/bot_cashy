// Verifica el branching de procesarTextoConNlp entre el flujo normal
// (quick_nlp -> Gemini -> quick_nlp) y el modo Full IA (OpenRouter, con
// quick_nlp solo como red de emergencia si OpenRouter falla).

jest.mock('../src/lib/telegraf', () => ({
  bot: { on: jest.fn(), command: jest.fn(), use: jest.fn(), hears: jest.fn(), action: jest.fn(), catch: jest.fn() },
}));

jest.mock('../src/auth', () => ({
  esAdminOriginal: jest.fn(() => false),
  obtenerClientePorUserId: jest.fn(),
}));

jest.mock('../src/services/openrouter.service', () => ({
  canAttemptFullIA: jest.fn(() => true),
  parseMessage: jest.fn(),
}));

jest.mock('../src/services/gemini.service', () => ({
  canAttemptRemoteNlp: jest.fn(() => true),
  parseMessage: jest.fn(),
}));

jest.mock('../src/services/quick_nlp.service', () => ({
  quickParse: jest.fn(),
}));

jest.mock('../src/handlers/nlp', () => ({
  handleNLPIntent: jest.fn().mockResolvedValue(true),
}));

// marcarAmbito solo hace trabajo real para 'registrar_movimiento'; en estos
// tests devolvemos intents de consulta (ver_balance) para no depender de
// personal.service/personal-nlp.service (I/O real a Sheets).
jest.mock('../src/services/personal.service', () => ({
  leerPreferencias: jest.fn().mockResolvedValue({}),
  obtenerViajeActivo: jest.fn().mockResolvedValue(null),
  correspondeAlViaje: jest.fn(() => false),
  fechaHoyStr: jest.fn(() => '2026-01-01'),
}));
jest.mock('../src/services/personal-nlp.service', () => ({
  resolverAmbito: jest.fn(() => ({ ambito: 'consultorio', ambiguo: false, termino: null })),
  inferirCategoriaPersonal: jest.fn(),
}));

const { obtenerClientePorUserId } = require('../src/auth');
const openrouterService = require('../src/services/openrouter.service');
const geminiService = require('../src/services/gemini.service');
const { quickParse } = require('../src/services/quick_nlp.service');
const { handleNLPIntent } = require('../src/handlers/nlp');
const state = require('../src/state');
const { procesarTextoConNlp } = require('../src/handlers/text');

function fakeCtx(userId = 1) {
  return { from: { id: userId }, reply: jest.fn().mockResolvedValue(true) };
}

const QUICK_RESULT = { intent: 'ver_balance', entities: {} };
const OPENROUTER_RESULT = { intent: 'ver_hoy', entities: {} };

beforeEach(() => {
  jest.clearAllMocks();
  state.processingNlp.clear();
  openrouterService.canAttemptFullIA.mockReturnValue(true);
  geminiService.canAttemptRemoteNlp.mockReturnValue(true);
  handleNLPIntent.mockResolvedValue(true);
});

describe('Full IA activado (cliente.modoFullIA + OpenRouter disponible)', () => {
  beforeEach(() => {
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: true });
    quickParse.mockReturnValue(QUICK_RESULT); // aunque quick_nlp resolvería con confianza...
  });

  test('usa OpenRouter como camino principal, NO quick_nlp ni Gemini', async () => {
    openrouterService.parseMessage.mockResolvedValue(OPENROUTER_RESULT);

    await procesarTextoConNlp(fakeCtx(), 'consulta Juan $15000 efectivo');

    expect(openrouterService.parseMessage).toHaveBeenCalledTimes(1);
    expect(geminiService.parseMessage).not.toHaveBeenCalled();
    expect(handleNLPIntent).toHaveBeenCalledTimes(1);
    expect(handleNLPIntent.mock.calls[0][1]).toMatchObject({ intent: 'ver_hoy' });
  });

  test('si OpenRouter falla, cae a quick_nlp como red de emergencia', async () => {
    openrouterService.parseMessage.mockResolvedValue(null);

    await procesarTextoConNlp(fakeCtx(), 'consulta Juan $15000 efectivo');

    expect(openrouterService.parseMessage).toHaveBeenCalledTimes(1);
    expect(geminiService.parseMessage).not.toHaveBeenCalled();
    expect(handleNLPIntent).toHaveBeenCalledTimes(1);
    expect(handleNLPIntent.mock.calls[0][1]).toMatchObject({ intent: 'ver_balance' });
  });

  test('si OpenRouter y quick_nlp fallan los dos, responde "no entendí"', async () => {
    openrouterService.parseMessage.mockResolvedValue(null);
    quickParse.mockReturnValue(null);

    const ctx = fakeCtx();
    await procesarTextoConNlp(ctx, 'texto sin sentido');

    expect(handleNLPIntent).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenLastCalledWith(expect.stringContaining('No entendí'));
  });
});

describe('Full IA desactivado o no disponible → flujo normal', () => {
  test('cliente.modoFullIA=false usa el flujo quick_nlp -> Gemini, nunca OpenRouter', async () => {
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: false });
    quickParse.mockReturnValue(QUICK_RESULT);

    await procesarTextoConNlp(fakeCtx(), 'consulta Juan $15000 efectivo');

    expect(openrouterService.parseMessage).not.toHaveBeenCalled();
    expect(handleNLPIntent).toHaveBeenCalledTimes(1);
    expect(handleNLPIntent.mock.calls[0][1]).toMatchObject({ intent: 'ver_balance' });
  });

  test('modoFullIA=true pero sin OPENROUTER_API_KEY (canAttemptFullIA=false) → flujo normal', async () => {
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: true });
    openrouterService.canAttemptFullIA.mockReturnValue(false);
    quickParse.mockReturnValue(QUICK_RESULT);

    await procesarTextoConNlp(fakeCtx(), 'consulta Juan $15000 efectivo');

    expect(openrouterService.parseMessage).not.toHaveBeenCalled();
    expect(handleNLPIntent).toHaveBeenCalledTimes(1);
  });
});
