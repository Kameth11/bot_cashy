// Caracterización de procesarFotoAgenda (visión de agendas con Gemini).

let generateContent;

function mockSdk(impl) {
  generateContent = jest.fn(impl);
  jest.doMock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn(() => ({
      getGenerativeModel: ({ model }) => ({
        generateContent: (parts) => generateContent(parts, model),
      }),
    })),
  }));
}

const texto = (t) => ({ response: { text: () => t } });

function loadService({ apiKey = 'test-key' } = {}) {
  jest.resetModules();
  jest.doMock('../src/config', () => ({
    GEMINI_API_KEY: apiKey,
    GEMINI_MODEL: 'gemini-2.5-flash-lite',
    GEMINI_VISION_MODEL: 'gemini-2.5-flash',
  }));
  // Sin sharp se usa la imagen original: el test no depende de procesar imágenes reales.
  jest.doMock('sharp', () => { throw new Error('no sharp'); });
  return require('../src/services/vision.service');
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.dontMock('@google/generative-ai');
  jest.dontMock('sharp');
});

describe('procesarFotoAgenda', () => {
  const buf = Buffer.from('img');

  test('sin API key → vision_no_configurada', async () => {
    mockSdk(async () => texto('{}'));
    const svc = loadService({ apiKey: '' });
    expect(await svc.procesarFotoAgenda(buf)).toEqual({ error: 'vision_no_configurada' });
  });

  test('sin SDK → vision_dependencia_faltante', async () => {
    jest.resetModules();
    jest.doMock('../src/config', () => ({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm', GEMINI_VISION_MODEL: 'v' }));
    jest.doMock('@google/generative-ai', () => { throw new Error('missing'); });
    jest.doMock('sharp', () => { throw new Error('no sharp'); });
    const svc = require('../src/services/vision.service');
    expect(await svc.procesarFotoAgenda(buf)).toEqual({ error: 'vision_dependencia_faltante' });
  });

  test('normaliza turnos: hora HH:MM, estado, nombres y consultorio', async () => {
    mockSdk(async () => texto(JSON.stringify({
      turnos: [{ consultorio: 'dos', profesional: 'laura pérez', hora: '9.30', cliente: 'juan fernández', servicio: 'limpieza', estado: 'confirmada' }],
    })));
    const svc = loadService();
    expect(await svc.procesarFotoAgenda(buf)).toEqual({
      turnos: [{ consultorio: '2', profesional: 'Laura Pérez', hora: '09:30', cliente: 'Juan Fernández', servicio: 'Limpieza', estado: 'Confirmado' }],
    });
  });

  test('estado ausente o desconocido queda Pendiente', async () => {
    mockSdk(async () => texto(JSON.stringify({ turnos: [{ hora: '10:00', cliente: 'Ana' }, { hora: '11:00', cliente: 'Beto', estado: 'raro' }] })));
    const svc = loadService();
    const r = await svc.procesarFotoAgenda(buf);
    expect(r.turnos.map((t) => t.estado)).toEqual(['Pendiente', 'Pendiente']);
  });

  test('descarta filas sin hora, cliente ni servicio', async () => {
    mockSdk(async () => texto(JSON.stringify({ turnos: [{ estado: 'Confirmado' }, { hora: '10:00' }] })));
    const svc = loadService();
    expect((await svc.procesarFotoAgenda(buf)).turnos).toHaveLength(1);
  });

  test('{error:"no_es_agenda"} se propaga', async () => {
    mockSdk(async () => texto('{"error":"no_es_agenda"}'));
    const svc = loadService();
    expect(await svc.procesarFotoAgenda(buf)).toEqual({ error: 'no_es_agenda' });
  });

  test('turnos vacíos → {turnos: []}', async () => {
    mockSdk(async () => texto('{"turnos":[]}'));
    const svc = loadService();
    expect(await svc.procesarFotoAgenda(buf)).toEqual({ turnos: [] });
  });

  test('extrae el JSON de un bloque de código', async () => {
    mockSdk(async () => texto('```json\n{"turnos":[{"hora":"8:00","cliente":"ana"}]}\n```'));
    const svc = loadService();
    expect((await svc.procesarFotoAgenda(buf)).turnos[0].hora).toBe('08:00');
  });

  test('manda la imagen como PNG base64 con modelo de visión primero', async () => {
    mockSdk(async () => texto('{"turnos":[]}'));
    const svc = loadService();
    await svc.procesarFotoAgenda(buf, 'image/jpeg');
    const [parts, model] = generateContent.mock.calls[0];
    expect(model).toBe('gemini-2.5-flash');
    expect(parts[0].inlineData.mimeType).toBe('image/png');
    expect(parts[0].inlineData.data).toBe(buf.toString('base64'));
  });

  test('si el modelo falla o devuelve JSON inválido prueba el siguiente', async () => {
    mockSdk(async (_p, model) => {
      if (model === 'gemini-2.5-flash') throw new Error('503');
      return texto('{"turnos":[{"hora":"10:00","cliente":"ana"}]}');
    });
    const svc = loadService();
    const r = await svc.procesarFotoAgenda(buf);
    expect(r.turnos).toHaveLength(1);
    expect(generateContent.mock.calls.map((c) => c[1])).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  });

  test('si todos los modelos fallan devuelve null', async () => {
    mockSdk(async () => { throw new Error('boom'); });
    const svc = loadService();
    expect(await svc.procesarFotoAgenda(buf)).toBeNull();
  });
});
