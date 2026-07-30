// Guarda de concurrencia: processingNlp evita que dos mensajes casi
// simultáneos del mismo usuario disparen dos parses NLP en paralelo (doble
// llamada a Gemini + posible doble registro). Verifica que el segundo mensaje
// se rechaza mientras el primero está en vuelo, y que el flag se limpia
// siempre (incluso si el parse falla).

jest.mock('../src/lib/telegraf', () => ({
  bot: { on: jest.fn(), command: jest.fn(), use: jest.fn(), hears: jest.fn(), action: jest.fn(), catch: jest.fn() },
}));
jest.mock('../src/services/gemini.service', () => ({
  canAttemptRemoteNlp: jest.fn(() => true),
  parseMessage: jest.fn(),
}));
jest.mock('../src/services/quick_nlp.service', () => ({
  quickParse: jest.fn(() => null),
}));

const geminiService = require('../src/services/gemini.service');
const state = require('../src/state');
const { procesarTextoConNlp } = require('../src/handlers/text');

function fakeCtx(userId) {
  return { from: { id: userId }, reply: jest.fn().mockResolvedValue(true) };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('processingNlp (anti doble-procesamiento)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    state.processingNlp.clear();
  });

  test('rechaza el segundo mensaje del mismo usuario mientras el primero está en vuelo', async () => {
    const gate = deferred();
    geminiService.parseMessage.mockReturnValueOnce(gate.promise);

    const ctx1 = fakeCtx(1);
    const ctx2 = fakeCtx(1);

    // Primer mensaje: entra y queda esperando a Gemini (gate sin resolver).
    const p1 = procesarTextoConNlp(ctx1, 'consulta juan 5000');

    // Segundo mensaje concurrente del MISMO usuario.
    await procesarTextoConNlp(ctx2, 'otra cosa');

    expect(ctx2.reply).toHaveBeenCalledWith(expect.stringMatching(/todav[ií]a estoy procesando/i));
    // Gemini se llamó UNA sola vez (el segundo no disparó otro parse).
    expect(geminiService.parseMessage).toHaveBeenCalledTimes(1);

    // Liberamos el primero y dejamos que termine.
    gate.resolve(null);
    await p1;

    // El flag quedó limpio.
    expect(state.processingNlp.has(1)).toBe(false);
  });

  test('limpia el flag aunque el parse lance (no deja al usuario trabado)', async () => {
    geminiService.parseMessage.mockRejectedValueOnce(new Error('gemini caído'));

    const ctx = fakeCtx(2);
    await procesarTextoConNlp(ctx, 'consulta');

    expect(state.processingNlp.has(2)).toBe(false);

    // Un mensaje posterior del mismo usuario NO queda bloqueado.
    geminiService.parseMessage.mockResolvedValueOnce(null);
    const ctx2 = fakeCtx(2);
    await procesarTextoConNlp(ctx2, 'consulta de nuevo');
    expect(ctx2.reply).not.toHaveBeenCalledWith(expect.stringMatching(/todav[ií]a estoy procesando/i));
  });

  test('usuarios distintos no se bloquean entre sí', async () => {
    const gate = deferred();
    geminiService.parseMessage.mockReturnValueOnce(gate.promise).mockResolvedValueOnce(null);

    const p1 = procesarTextoConNlp(fakeCtx(10), 'consulta');
    const ctx2 = fakeCtx(20);
    await procesarTextoConNlp(ctx2, 'consulta');

    // El usuario 20 NO fue rechazado por el procesamiento del usuario 10.
    expect(ctx2.reply).not.toHaveBeenCalledWith(expect.stringMatching(/todav[ií]a estoy procesando/i));

    gate.resolve(null);
    await p1;
  });
});
