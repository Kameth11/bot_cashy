// Reintentos de la Sheets API: 429/503 siempre; otros 5xx y errores de red solo
// en GET (para no duplicar filas en un append que quizás sí se aplicó).

const axios = require('axios');
const { instalarReintentos, esReintentable } = require('../src/lib/google');

function cliente(respuestas) {
  const instancia = axios.create();
  const llamadas = [];
  instancia.defaults.adapter = async (config) => {
    llamadas.push(config.method);
    const r = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)];
    if (r.ok) return { data: 'ok', status: 200, statusText: 'OK', headers: {}, config };
    const err = new axios.AxiosError('fail', r.code, config, {}, r.status ? { status: r.status, headers: r.headers || {}, data: {}, config } : undefined);
    throw err;
  };
  const esperas = [];
  instalarReintentos(instancia, { sleep: async ms => { esperas.push(ms); }, maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 20000 });
  return { instancia, llamadas, esperas };
}

describe('reintentos de la Sheets API', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test('429 en POST: reintenta y termina bien', async () => {
    const { instancia, llamadas, esperas } = cliente([{ status: 429 }, { status: 429 }, { ok: true }]);
    const res = await instancia.post('/x', {});
    expect(res.data).toBe('ok');
    expect(llamadas).toHaveLength(3);
    expect(esperas).toHaveLength(2);
    expect(esperas[1]).toBeGreaterThanOrEqual(esperas[0] / 2); // backoff creciente (con jitter)
  });

  test('respeta Retry-After', async () => {
    const { instancia, esperas } = cliente([{ status: 429, headers: { 'retry-after': '7' } }, { ok: true }]);
    await instancia.get('/x');
    expect(esperas).toEqual([7000]);
  });

  test('se rinde tras maxRetries y propaga el error', async () => {
    const { instancia, llamadas } = cliente([{ status: 429 }]);
    await expect(instancia.get('/x')).rejects.toMatchObject({ response: { status: 429 } });
    expect(llamadas).toHaveLength(4); // 1 original + 3 reintentos
  });

  test('500 en POST NO se reintenta (podría duplicar una fila)', async () => {
    const { instancia, llamadas } = cliente([{ status: 500 }, { ok: true }]);
    await expect(instancia.post('/x', {})).rejects.toBeDefined();
    expect(llamadas).toHaveLength(1);
  });

  test('500 y error de red en GET sí se reintentan', async () => {
    const a = cliente([{ status: 500 }, { ok: true }]);
    await a.instancia.get('/x');
    expect(a.llamadas).toHaveLength(2);
    const b = cliente([{ code: 'ECONNRESET' }, { ok: true }]);
    await b.instancia.get('/x');
    expect(b.llamadas).toHaveLength(2);
  });

  test('400/403/404 nunca se reintentan', () => {
    for (const status of [400, 403, 404]) {
      expect(esReintentable({ config: { method: 'get' }, response: { status } })).toBe(false);
    }
  });
});
