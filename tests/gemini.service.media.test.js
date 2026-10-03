// Caracterización de transcribirAudio y generarRespuestaAgenda (gemini.service).

let generateContent;

function mockSdk(impl) {
  generateContent = jest.fn(impl);
  jest.doMock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn(() => ({
      getGenerativeModel: ({ model }) => ({
        generateContent: (prompt, opts) => generateContent(prompt, opts, model),
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
  return require('../src/services/gemini.service');
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.dontMock('@google/generative-ai'));

describe('transcribirAudio', () => {
  test('sin API key devuelve null', async () => {
    mockSdk(async () => texto('hola'));
    const svc = loadService({ apiKey: '' });
    expect(await svc.transcribirAudio(Buffer.from('x'))).toBeNull();
    expect(generateContent).not.toHaveBeenCalled();
  });

  test('devuelve la transcripción sin espacios sobrantes', async () => {
    mockSdk(async () => texto('  consulta Juan 15000  \n'));
    const svc = loadService();
    expect(await svc.transcribirAudio(Buffer.from('x'))).toBe('consulta Juan 15000');
  });

  test('manda el audio en base64 con el mimeType recibido', async () => {
    mockSdk(async () => texto('ok'));
    const svc = loadService();
    await svc.transcribirAudio(Buffer.from('abc'), 'audio/mpeg');
    const [parts] = generateContent.mock.calls[0];
    expect(parts[0].inlineData).toEqual({ data: Buffer.from('abc').toString('base64'), mimeType: 'audio/mpeg' });
    expect(typeof parts[1]).toBe('string');
  });

  test('usa primero GEMINI_VISION_MODEL', async () => {
    mockSdk(async () => texto('ok'));
    const svc = loadService();
    await svc.transcribirAudio(Buffer.from('x'));
    expect(generateContent.mock.calls[0][2]).toBe('gemini-2.5-flash');
  });

  test('si un modelo falla prueba el siguiente (sin repetir modelos)', async () => {
    mockSdk(async (_p, _o, model) => {
      if (model === 'gemini-2.5-flash') throw new Error('503 overloaded');
      return texto('listo');
    });
    const svc = loadService();
    expect(await svc.transcribirAudio(Buffer.from('x'))).toBe('listo');
    expect(generateContent.mock.calls.map((c) => c[2])).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  });

  test('si todos los modelos fallan devuelve null', async () => {
    mockSdk(async () => { throw new Error('boom'); });
    const svc = loadService();
    expect(await svc.transcribirAudio(Buffer.from('x'))).toBeNull();
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});

describe('generarRespuestaAgenda', () => {
  const turnos = [
    { hora: '15:00', cliente: 'Ana', servicio: 'Limpieza', profesional: 'Laura', estado: 'Confirmado' },
    { hora: '09:30', cliente: 'Beto', estado: 'Pendiente' },
  ];

  test('arma el prompt con los turnos ordenados por hora', async () => {
    mockSdk(async () => texto('Tenés 2 turnos'));
    const svc = loadService();
    await svc.generarRespuestaAgenda('¿qué tengo hoy?', turnos);
    const prompt = generateContent.mock.calls[0][0];
    expect(prompt.indexOf('09:30')).toBeLessThan(prompt.indexOf('15:00'));
    expect(prompt).toContain('Ana (Limpieza) [Laura]');
    expect(prompt).toContain('¿qué tengo hoy?');
  });

  test('devuelve el texto recortado', async () => {
    mockSdk(async () => texto('  Tenés 2 turnos  '));
    const svc = loadService();
    expect(await svc.generarRespuestaAgenda('hoy', turnos)).toBe('Tenés 2 turnos');
  });

  test('texto vacío devuelve null', async () => {
    mockSdk(async () => texto(''));
    const svc = loadService();
    expect(await svc.generarRespuestaAgenda('hoy', turnos)).toBeNull();
  });

  test('error de la API devuelve null (el handler cae al armado manual)', async () => {
    mockSdk(async () => { throw new Error('500'); });
    const svc = loadService();
    expect(await svc.generarRespuestaAgenda('hoy', turnos)).toBeNull();
  });
});
