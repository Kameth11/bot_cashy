jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } },
}));

const { app } = require('../src/api/index.js');

describe('POST /api/auth/request-code y /api/auth/verify - rate limiting', () => {
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

  function postJson(path, body) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  test('request-code: bloquea con 429 despues de 5 intentos para el mismo usuario', async () => {
    const userId = process.env.AUTHORIZED_USER_ID; // admin, pasa el chequeo de registro

    for (let i = 0; i < 5; i++) {
      const res = await postJson('/api/auth/request-code', { userId });
      expect(res.status).not.toBe(429);
    }

    const blocked = await postJson('/api/auth/request-code', { userId });
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toMatch(/intentos/i);
  });

  test('verify: bloquea con 429 despues de 10 intentos para el mismo usuario', async () => {
    const userId = 'verify-rate-limit-user';

    for (let i = 0; i < 10; i++) {
      const res = await postJson('/api/auth/verify', { userId, code: '000000' });
      expect(res.status).not.toBe(429);
    }

    const blocked = await postJson('/api/auth/verify', { userId, code: '000000' });
    expect(blocked.status).toBe(429);
  });
});
