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
const quota = require('../src/lib/ai-quota');
const { procesarTextoConNlp } = require('../src/handlers/text');

const fakeCtx = () => ({ from: { id: 1 }, reply: jest.fn().mockResolvedValue(true) });

beforeEach(() => {
  jest.clearAllMocks();
  quota.reiniciar();
  process.env.AI_LIMIT_TEXTO_DIA = '1';
  state.processingNlp.clear();
  openrouterService.canAttemptFullIA.mockReturnValue(true);
  geminiService.canAttemptRemoteNlp.mockReturnValue(true);
  handleNLPIntent.mockResolvedValue(true);
  quickParse.mockReturnValue(null); // quick_nlp no resuelve: hace falta IA
});
afterAll(() => { delete process.env.AI_LIMIT_TEXTO_DIA; });

test('al agotar la cuota diaria NO se llama a la IA y se avisa una sola vez', async () => {
  obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: false });
  geminiService.parseMessage.mockResolvedValue({ intent: 'desconocido' });

  await procesarTextoConNlp(fakeCtx(), 'algo ambiguo uno');           // usa el único cupo
  expect(geminiService.parseMessage).toHaveBeenCalledTimes(1);

  const ctx2 = fakeCtx();
  await procesarTextoConNlp(ctx2, 'algo ambiguo dos');               // cupo agotado
  expect(geminiService.parseMessage).toHaveBeenCalledTimes(1);       // no hubo otra llamada
  expect(ctx2.reply.mock.calls.some(c => /límite diario de uso de IA/.test(c[0]))).toBe(true);

  const ctx3 = fakeCtx();
  await procesarTextoConNlp(ctx3, 'algo ambiguo tres');
  expect(ctx3.reply.mock.calls.some(c => /límite diario de uso de IA/.test(c[0]))).toBe(false);
});

test('en modo Full IA también respeta la cuota', async () => {
  obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: true });
  openrouterService.parseMessage.mockResolvedValue({ intent: 'desconocido' });

  await procesarTextoConNlp(fakeCtx(), 'uno');
  await procesarTextoConNlp(fakeCtx(), 'dos');
  expect(openrouterService.parseMessage).toHaveBeenCalledTimes(1);
});
