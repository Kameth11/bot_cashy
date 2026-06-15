const jwt = require('jsonwebtoken');
const { app, JWT_SECRET } = require('../src/api/index.js');
const eventsService = require('../src/services/events.service');

function signToken(userId, overrides = {}) {
  return jwt.sign({ userId: String(userId), type: 'dashboard', ...overrides }, JWT_SECRET, { expiresIn: '180d' });
}

async function readSseChunk(reader, timeoutMs = 1000) {
  const decoder = new TextDecoder();
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const read = reader.read().then(({ value, done }) => (done ? null : decoder.decode(value)));
  return Promise.race([read, timeout]);
}

describe('GET /api/events - seguridad', () => {
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

  test('sin header Authorization devuelve 401', async () => {
    const res = await fetch(`${baseUrl}/api/events`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('No autorizado');
  });

  test('con token invalido devuelve 401', async () => {
    const res = await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: 'Bearer token-invalido' },
    });
    expect(res.status).toBe(401);
  });

  test('con token expirado devuelve 401', async () => {
    const expiredToken = jwt.sign({ userId: '1001', type: 'dashboard' }, JWT_SECRET, { expiresIn: '-1s' });
    const res = await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(res.status).toBe(401);
  });

  test('con token firmado con otro secreto devuelve 401', async () => {
    const tokenOtroSecreto = jwt.sign({ userId: '1001', type: 'dashboard' }, 'otro-secreto-cualquiera', { expiresIn: '180d' });
    const res = await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${tokenOtroSecreto}` },
    });
    expect(res.status).toBe(401);
  });

  test('con token valido devuelve 200 y headers SSE', async () => {
    const token = signToken('1001');
    const res = await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');

    await res.body.getReader().cancel();
  });

  test('aislamiento multi-tenant: un usuario no recibe eventos de otro', async () => {
    const tokenA = signToken('aaa-111');
    const tokenB = signToken('bbb-222');

    const resA = await fetch(`${baseUrl}/api/events`, { headers: { Authorization: `Bearer ${tokenA}` } });
    const resB = await fetch(`${baseUrl}/api/events`, { headers: { Authorization: `Bearer ${tokenB}` } });

    const readerA = resA.body.getReader();
    const readerB = resB.body.getReader();

    // Consumimos el mensaje inicial ": connected"
    await readSseChunk(readerA);
    await readSseChunk(readerB);

    // Disparamos un cambio de movimientos solo para el usuario A
    eventsService.emitMovimientosUpdated('aaa-111');

    const chunkA = await readSseChunk(readerA);
    const chunkB = await readSseChunk(readerB);

    expect(chunkA).toContain('event: movimientos_updated');
    expect(chunkB).toBeNull(); // usuario B no debe recibir nada

    await readerA.cancel();
    await readerB.cancel();
  });
});
