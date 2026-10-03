// Tests de caracterización de gemini.service (NLP de texto): fijan el
// comportamiento actual antes de extraer la capa de proveedores de IA
// (cache, cooldowns, fallback de modelos, parseo de JSON).

const VALID = JSON.stringify({ intent: 'ver_hoy', entities: {} });

let generateContent;
let getGenerativeModel;

function mockSdk(impl) {
  generateContent = jest.fn(impl);
  getGenerativeModel = jest.fn(({ model }) => ({
    generateContent: (prompt, opts) => generateContent(prompt, opts, model),
  }));
  jest.doMock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel })),
  }));
}

function respuesta(text, finishReason = 'STOP') {
  return { response: { text: () => text, candidates: [{ finishReason }] } };
}

function loadService({ apiKey = 'test-key', model = 'gemini-2.5-flash-lite' } = {}) {
  jest.resetModules();
  jest.doMock('../src/config', () => ({
    GEMINI_API_KEY: apiKey,
    GEMINI_MODEL: model,
    GEMINI_VISION_MODEL: 'gemini-2.5-flash',
  }));
  return require('../src/services/gemini.service');
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.dontMock('@google/generative-ai');
});

describe('gemini.service.parseMessage', () => {
  test('sin GEMINI_API_KEY devuelve null y no llama a la API', async () => {
    mockSdk(async () => respuesta(VALID));
    const svc = loadService({ apiKey: '' });
    expect(await svc.parseMessage(1, 'ver hoy')).toBeNull();
    expect(generateContent).not.toHaveBeenCalled();
    expect(svc.canAttemptRemoteNlp()).toBe(false);
  });

  test('respuesta válida devuelve {intent, entities} normalizado', async () => {
    mockSdk(async () => respuesta(VALID));
    const svc = loadService();
    const r = await svc.parseMessage(1, 'ver hoy');
    expect(r.intent).toBe('ver_hoy');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  test('prueba primero el modelo preferido', async () => {
    mockSdk(async () => respuesta(VALID));
    const svc = loadService({ model: 'gemini-2.5-flash-lite' });
    await svc.parseMessage(1, 'ver hoy');
    expect(generateContent.mock.calls[0][2]).toBe('gemini-2.5-flash-lite');
  });

  test('cache: mismo usuario y texto (sin importar mayúsculas/espacios) no vuelve a llamar', async () => {
    mockSdk(async () => respuesta(VALID));
    const svc = loadService();
    await svc.parseMessage(1, 'Ver Hoy');
    await svc.parseMessage(1, '  ver hoy ');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  test('cache: otro usuario con el mismo texto sí llama de nuevo', async () => {
    mockSdk(async () => respuesta(VALID));
    const svc = loadService();
    await svc.parseMessage(1, 'ver hoy');
    await svc.parseMessage(2, 'ver hoy');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  test('cache: expira a los 60 s', async () => {
    jest.useFakeTimers();
    mockSdk(async () => respuesta(VALID));
    const svc = loadService();
    await svc.parseMessage(1, 'ver hoy');
    jest.setSystemTime(Date.now() + 59000);
    await svc.parseMessage(1, 'ver hoy');
    expect(generateContent).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.now() + 2000);
    await svc.parseMessage(1, 'ver hoy');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  test('fallback: si el primer modelo falla prueba el siguiente', async () => {
    mockSdk(async (_p, _o, model) => {
      if (model === 'gemini-2.5-flash-lite') throw new Error('404 model not found');
      return respuesta(VALID);
    });
    const svc = loadService({ model: 'gemini-2.5-flash-lite' });
    const r = await svc.parseMessage(1, 'ver hoy');
    expect(r.intent).toBe('ver_hoy');
    const modelos = generateContent.mock.calls.map((c) => c[2]);
    expect(modelos[0]).toBe('gemini-2.5-flash-lite');
    expect(modelos).toContain('gemini-2.5-flash');
  });

  test('429 en todos los modelos activa cooldown y corta llamadas siguientes', async () => {
    mockSdk(async () => { throw new Error('429 Too Many Requests'); });
    const svc = loadService();
    expect(await svc.parseMessage(1, 'uno')).toBeNull();
    const llamadas = generateContent.mock.calls.length;
    expect(svc.canAttemptRemoteNlp()).toBe(false);
    expect(await svc.parseMessage(1, 'dos')).toBeNull();
    expect(generateContent).toHaveBeenCalledTimes(llamadas);
  });

  test('cooldown por rate limit dura 65 s', async () => {
    jest.useFakeTimers();
    mockSdk(async () => { throw new Error('quota exceeded'); });
    const svc = loadService();
    await svc.parseMessage(1, 'uno');
    jest.setSystemTime(Date.now() + 64000);
    expect(svc.canAttemptRemoteNlp()).toBe(false);
    jest.setSystemTime(Date.now() + 2000);
    expect(svc.canAttemptRemoteNlp()).toBe(true);
  });

  test('503/overloaded activa cooldown de servicio de 180 s', async () => {
    jest.useFakeTimers();
    mockSdk(async () => { throw new Error('503 Service Unavailable'); });
    const svc = loadService();
    expect(await svc.parseMessage(1, 'uno')).toBeNull();
    expect(svc.canAttemptRemoteNlp()).toBe(false);
    jest.setSystemTime(Date.now() + 179000);
    expect(svc.canAttemptRemoteNlp()).toBe(false);
    jest.setSystemTime(Date.now() + 2000);
    expect(svc.canAttemptRemoteNlp()).toBe(true);
  });

  test('un error genérico no activa ningún cooldown', async () => {
    mockSdk(async () => { throw new Error('boom'); });
    const svc = loadService();
    expect(await svc.parseMessage(1, 'uno')).toBeNull();
    expect(svc.canAttemptRemoteNlp()).toBe(true);
  });

  test('respuesta vacía se trata como fallo y prueba otro modelo', async () => {
    let n = 0;
    mockSdk(async () => respuesta(n++ === 0 ? '' : VALID));
    const svc = loadService();
    const r = await svc.parseMessage(1, 'ver hoy');
    expect(r.intent).toBe('ver_hoy');
    expect(generateContent.mock.calls.length).toBeGreaterThan(1);
  });

  test('extrae el JSON de un bloque ```json', async () => {
    mockSdk(async () => respuesta('```json\n' + VALID + '\n```'));
    const svc = loadService();
    expect((await svc.parseMessage(1, 'ver hoy')).intent).toBe('ver_hoy');
  });

  test('extrae el JSON rodeado de texto', async () => {
    mockSdk(async () => respuesta('Claro: ' + VALID + ' listo'));
    const svc = loadService();
    expect((await svc.parseMessage(1, 'ver hoy')).intent).toBe('ver_hoy');
  });

  test('repara un JSON truncado al que le falta la llave de cierre', async () => {
    mockSdk(async () => respuesta('{"intent": "ver_hoy"'));
    const svc = loadService();
    const r = await svc.parseMessage(1, 'ver hoy');
    expect(r && r.intent).toBe('ver_hoy');
  });

  test('respuesta sin JSON devuelve null y no se cachea', async () => {
    mockSdk(async () => respuesta('no sé qué decirte'));
    const svc = loadService();
    expect(await svc.parseMessage(1, 'hola')).toBeNull();
    await svc.parseMessage(1, 'hola');
    expect(generateContent.mock.calls.length).toBeGreaterThan(1);
  });

  test('JSON sin intent devuelve null', async () => {
    mockSdk(async () => respuesta('{"entities": {}}'));
    const svc = loadService();
    expect(await svc.parseMessage(1, 'hola')).toBeNull();
  });

  test('si falta el SDK el servicio se desactiva sin romper', async () => {
    jest.resetModules();
    jest.doMock('../src/config', () => ({
      GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm', GEMINI_VISION_MODEL: 'v',
    }));
    jest.doMock('@google/generative-ai', () => { throw new Error('Cannot find module'); });
    const svc = require('../src/services/gemini.service');
    expect(await svc.parseMessage(1, 'ver hoy')).toBeNull();
  });
});
