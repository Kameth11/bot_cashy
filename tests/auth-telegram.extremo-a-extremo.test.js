// Camino COMPLETO del login con Telegram, con las piezas reales:
//   API start -> deep link -> /start login_<id> en el bot -> botón ✅ -> API status
//   -> sesión -> /api/auth/me.
// Solo se simulan Telegram y la lista de clientes. Existe porque esta semana un
// traspaso roto entre piezas pasó desapercibido: cada pieza tenía su test.

const mockCmds = {};
const mockActions = [];

jest.mock('../src/lib/telegraf', () => ({
  bot: {
    command: (name, h) => { mockCmds[name] = h; },
    action: (re, h) => { mockActions.push({ re, h }); },
    telegram: { sendMessage: jest.fn().mockResolvedValue(true), getMe: jest.fn().mockResolvedValue({ username: 'cashy_e2e_bot' }) },
  },
}));
jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111, JWT_SECRET: 'test-secret-e2e-login', ALLOWED_EMAILS: [], CODIGO_EXPIRACION_HORAS: 24,
  MAX_INTENTOS_CODIGO: 5, USE_SUPABASE: false, CLIENTES_FILE: '/tmp/clientes_e2e_login_test.json',
  SPREADSHEET_ID: 'sheet-test', DASHBOARD_API_PORT: 0, SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));
jest.mock('../src/services/cliente.service', () => ({
  get clientes() { return { '2222': { email: 'owner@test.com', sheetId: 'sheet-owner', usuarios: [], permisos: {} } }; },
  cargarClientes: jest.fn().mockResolvedValue({}), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));
jest.mock('../src/services/registration.service', () => ({ handleStart: jest.fn(async () => ({ message: 'REGISTRO' })) }));

const botInfo = require('../src/lib/bot-info');
const loginTelegram = require('../src/services/login-telegram.service');
const registration = require('../src/services/registration.service');
const { app } = require('../src/api/index.js');
require('../src/handlers/commands/start');
require('../src/handlers/login-actions');

const accion = () => mockActions.find((a) => String(a.re).includes('login_'));

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});
afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => { loginTelegram._reiniciar(); botInfo._reiniciarCache(); jest.clearAllMocks(); });

async function post(path, body, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json() };
}

// Lo que haría la persona en Telegram con el deep link que le muestra el navegador.
async function abrirDeepLinkEnTelegram(deepLink, userId) {
  const payload = new URL(deepLink).searchParams.get('start');
  const ctx = {
    from: { id: userId }, chat: { type: 'private' }, message: { text: `/start ${payload}` },
    reply: jest.fn().mockResolvedValue(true),
  };
  await mockCmds.start(ctx);
  return ctx;
}
async function tocar(ctxStart, userId, indiceBoton) {
  const data = ctxStart.reply.mock.calls[0][1].reply_markup.inline_keyboard.flat()[indiceBoton].callback_data;
  const ctx = {
    from: { id: userId }, chat: { type: 'private' }, match: accion().re.exec(data),
    answerCbQuery: jest.fn().mockResolvedValue(true), editMessageText: jest.fn().mockResolvedValue(true),
  };
  await accion().h(ctx);
  return ctx;
}

test('el camino feliz: el navegador entra solo después de que la persona toca "Sí, soy yo"', async () => {
  const ua = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
  const inicio = await post('/api/auth/telegram/start', {}, { 'User-Agent': ua });
  expect(inicio.status).toBe(201);

  // 1) el navegador espera
  expect((await post('/api/auth/telegram/status', { id: inicio.body.id, secret: inicio.body.secret })).body).toEqual({ estado: 'pendiente' });

  // 2) la persona abre el link en Telegram y ve DESDE DÓNDE se pidió
  const ctxStart = await abrirDeepLinkEnTelegram(inicio.body.deepLink, 2222);
  expect(ctxStart.reply.mock.calls[0][0]).toContain('Safari en iPad');
  expect(registration.handleStart).not.toHaveBeenCalled();

  // 3) todavía no entra: falta la aprobación
  expect((await post('/api/auth/telegram/status', { id: inicio.body.id, secret: inicio.body.secret })).body).toEqual({ estado: 'pendiente' });

  // 4) toca ✅
  const ctxBoton = await tocar(ctxStart, 2222, 0);
  expect(ctxBoton.editMessageText.mock.calls[0][0]).toMatch(/Listo/);

  // 5) el navegador recibe la sesión, una sola vez
  const sesion = await post('/api/auth/telegram/status', { id: inicio.body.id, secret: inicio.body.secret });
  expect(sesion.body.estado).toBe('aprobada');
  expect(sesion.body.user).toMatchObject({ userId: '2222', isOwner: true });

  // 6) el token sirve de verdad
  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${sesion.body.token}` } });
  expect(me.status).toBe(200);
  expect((await me.json()).user.email).toBe('owner@test.com');

  // 7) y no se puede volver a pedir
  expect((await post('/api/auth/telegram/status', { id: inicio.body.id, secret: inicio.body.secret })).body.estado).toBe('vencida');
});

test('"No fui yo": el navegador no entra', async () => {
  const inicio = await post('/api/auth/telegram/start');
  const ctxStart = await abrirDeepLinkEnTelegram(inicio.body.deepLink, 2222);
  await tocar(ctxStart, 2222, 1);
  const r = await post('/api/auth/telegram/status', { id: inicio.body.id, secret: inicio.body.secret });
  expect(r.body).toEqual({ estado: 'rechazada' });
  expect(r.body.token).toBeUndefined();
});

test('alguien que vio el link/QR pero NO tiene el secret no obtiene la sesión, aunque la persona apruebe', async () => {
  const inicio = await post('/api/auth/telegram/start');
  const ctxStart = await abrirDeepLinkEnTelegram(inicio.body.deepLink, 2222);
  await tocar(ctxStart, 2222, 0);

  const espia = await post('/api/auth/telegram/status', { id: inicio.body.id, secret: 'lo-que-sea' });
  expect(espia.body).toEqual({ estado: 'vencida' });
  // el navegador legítimo todavía puede
  expect((await post('/api/auth/telegram/status', { id: inicio.body.id, secret: inicio.body.secret })).body.estado).toBe('aprobada');
});

test('una persona sin cuenta que abre el link no entra ni inicia un alta', async () => {
  const inicio = await post('/api/auth/telegram/start');
  const ctxStart = await abrirDeepLinkEnTelegram(inicio.body.deepLink, 9999);
  expect(ctxStart.reply.mock.calls[0][0]).toMatch(/no está registrada/);
  expect(registration.handleStart).not.toHaveBeenCalled();
  expect((await post('/api/auth/telegram/status', { id: inicio.body.id, secret: inicio.body.secret })).body).toEqual({ estado: 'pendiente' });
});

test('el deep link usa el username del bot y un payload que Telegram acepta (A-Za-z0-9_-, hasta 64)', async () => {
  const { body } = await post('/api/auth/telegram/start');
  const url = new URL(body.deepLink);
  expect(url.hostname).toBe('t.me');
  expect(url.pathname).toBe('/cashy_e2e_bot');
  expect(url.searchParams.get('start')).toMatch(/^login_[A-Za-z0-9_-]{22}$/);
  expect(url.searchParams.get('start').length).toBeLessThanOrEqual(64);
});
