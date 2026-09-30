// Detrás de un proxy (Railway) req.ip debe salir de X-Forwarded-For; si no, todos
// los clientes comparten un único bucket de rate limit.

jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } },
}));

const { app } = require('../src/api/index.js');

describe('trust proxy + rate limit por cliente', () => {
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
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  const get = (ip) => fetch(`${baseUrl}/api/movimientos`, { headers: { 'X-Forwarded-For': ip } });

  test('agotar el cupo de un cliente no bloquea a otro', async () => {
    let bloqueado = false;
    for (let i = 0; i < 125; i++) {
      if ((await get('203.0.113.10')).status === 429) { bloqueado = true; break; }
    }
    expect(bloqueado).toBe(true);

    const otro = await get('203.0.113.11');
    expect(otro.status).toBe(401); // pasó el rate limit, cae en authMiddleware
  });
});
