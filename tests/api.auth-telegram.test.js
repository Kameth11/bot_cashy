// /api/auth/telegram/*: el navegador crea una solicitud y espera; el bot la
// aprueba (acá se llama al servicio directo: el bot se prueba en otro test).

jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true), getMe: jest.fn().mockResolvedValue({ username: 'cashy_test_bot' }) } },
}));
jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  JWT_SECRET: 'test-secret-auth-telegram',
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  MAX_INTENTOS_CODIGO: 5,
  USE_SUPABASE: false,
  CLIENTES_FILE: '/tmp/clientes_auth_telegram_test.json',
  SPREADSHEET_ID: 'sheet-test',
  DASHBOARD_API_PORT: 0,
  SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));
jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return { '2222': { email: 'owner@test.com', sheetId: 'sheet-owner', usuarios: [3333], permisos: {} } };
  },
  cargarClientes: jest.fn().mockResolvedValue({}),
  guardarClientes: jest.fn().mockResolvedValue(undefined),
  getCliente: jest.fn(), eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const botInfo = require('../src/lib/bot-info');
const loginTelegram = require('../src/services/login-telegram.service');
const { app, JWT_SECRET } = require('../src/api/index.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});
afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => {
  loginTelegram._reiniciar();
  botInfo._reiniciarCache();
  delete process.env.BOT_USERNAME;
});

async function post(path, body, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}
const start = (headers) => post('/api/auth/telegram/start', {}, headers);
const status = (id, secret) => post('/api/auth/telegram/status', { id, secret });

describe('POST /api/auth/telegram/start', () => {
  test('crea la solicitud y devuelve el deep link del bot', async () => {
    const r = await start({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36' });
    expect(r.status).toBe(201);
    expect(r.body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(r.body.secret).toHaveLength(43);
    expect(r.body.deepLink).toBe(`https://t.me/cashy_test_bot?start=login_${r.body.id}`);
    expect(r.body.expiraEnSeg).toBe(300);
    // y quedó guardado el navegador para mostrárselo a la persona en el bot
    expect(loginTelegram.obtenerParaAprobar(r.body.id).navegador).toBe('Chrome en Windows');
  });

  test('BOT_USERNAME manda sobre getMe', async () => {
    process.env.BOT_USERNAME = '@otro_bot';
    expect((await start()).body.deepLink).toContain('t.me/otro_bot?');
  });

  test('si no se puede obtener el username del bot: 503 con mensaje (la UI cae al código)', async () => {
    const { bot } = require('../src/lib/telegraf');
    bot.telegram.getMe.mockRejectedValueOnce(new Error('sin red'));
    const r = await start();
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/código/);
    expect(loginTelegram._cantidad()).toBe(0);
  });
});

describe('POST /api/auth/telegram/status', () => {
  test('pendiente mientras nadie aprueba', async () => {
    const { body } = await start();
    const r = await status(body.id, body.secret);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ estado: 'pendiente' });
  });

  test('aprobada: entrega la sesión una sola vez, y el token sirve en /api/auth/me', async () => {
    const { body } = await start();
    loginTelegram.aprobar(body.id, 2222);

    const r = await status(body.id, body.secret);
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('aprobada');
    expect(r.body.user).toMatchObject({ userId: '2222', isOwner: true, email: 'owner@test.com' });

    const decoded = jwt.verify(r.body.token, JWT_SECRET);
    expect(decoded).toMatchObject({ userId: '2222', type: 'dashboard' });
    expect(decoded.authAt).toBeGreaterThan(0);

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${r.body.token}` } });
    expect(me.status).toBe(200);
    expect((await me.json()).user.userId).toBe('2222');

    // segunda vez: ya no se entrega
    expect((await status(body.id, body.secret)).body).toEqual({ estado: 'vencida' });
  });

  test('el admin también entra', async () => {
    const { body } = await start();
    loginTelegram.aprobar(body.id, 1111);
    const r = await status(body.id, body.secret);
    expect(r.body.user).toMatchObject({ userId: '1111', isAdmin: true });
  });

  test('rechazada', async () => {
    const { body } = await start();
    loginTelegram.rechazar(body.id);
    expect((await status(body.id, body.secret)).body).toEqual({ estado: 'rechazada' });
  });

  test('con el id público pero SIN el secret no se obtiene la sesión', async () => {
    const { body } = await start();
    loginTelegram.aprobar(body.id, 2222);
    for (const secret of [undefined, '', 'adivinando']) {
      const r = await status(body.id, secret);
      expect(r.body).toEqual({ estado: 'vencida' });
      expect(r.body.token).toBeUndefined();
    }
    // la solicitud real sigue intacta para su dueño
    expect((await status(body.id, body.secret)).body.estado).toBe('aprobada');
  });

  test('NUNCA responde 401 (el interceptor del dashboard recargaría la página)', async () => {
    for (const body of [{}, { id: 'x', secret: 'y' }, { id: 'a'.repeat(22), secret: 'z' }]) {
      expect((await post('/api/auth/telegram/status', body)).status).toBe(200);
    }
  });

  test('si la persona fue dada de baja entre la aprobación y la entrega, no se entrega la sesión', async () => {
    const { body } = await start();
    loginTelegram.aprobar(body.id, 9999); // no registrado
    const r = await status(body.id, body.secret);
    expect(r.body).toEqual({ estado: 'rechazada' });
    expect(r.body.token).toBeUndefined();
  });
});
