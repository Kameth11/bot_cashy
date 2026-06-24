// Guarda de escalabilidad: el middleware global de /api debe cortar con 429
// cuando una IP supera el cupo, para proteger la cuota de Google Sheets / la
// DB de un dashboard con refresh agresivo o de abuso. Y NO debe limitar las
// rutas excluidas (auth tiene su propio limiter, /events es SSE de conexion
// larga, /cotizacion es publica y barata).

jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } },
}));

const { app } = require('../src/api/index.js');

describe('rate limit global de /api', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('/api/movimientos pasa a 429 al superar el cupo (sin token = 401 hasta que corta)', async () => {
    // El middleware corre ANTES del authMiddleware, asi que sin token las
    // primeras respuestas son 401 (pasaron el rate limit) y, al superar el
    // cupo, empiezan a ser 429.
    const LIMITE = 120;
    let vio429 = false;
    let status401Antes = 0;

    for (let i = 0; i < LIMITE + 5; i++) {
      const res = await fetch(`${baseUrl}/api/movimientos`);
      if (res.status === 429) { vio429 = true; break; }
      if (res.status === 401) status401Antes++;
    }

    expect(status401Antes).toBeGreaterThan(0); // dejó pasar requests legítimas
    expect(vio429).toBe(true);                 // pero terminó cortando
  });

  test('/api/cotizacion (excluida) nunca devuelve 429', async () => {
    // Aunque el bucket de la IP ya quedó agotado por el test anterior,
    // cotizacion está excluida del limiter.
    for (let i = 0; i < 130; i++) {
      const res = await fetch(`${baseUrl}/api/cotizacion`);
      expect(res.status).not.toBe(429);
    }
  });

  test('helmet agrega headers de seguridad estándar', async () => {
    const res = await fetch(`${baseUrl}/api/cotizacion`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBeTruthy();
    // CSP desactivada a propósito (el mismo server sirve el SPA del dashboard).
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
});
