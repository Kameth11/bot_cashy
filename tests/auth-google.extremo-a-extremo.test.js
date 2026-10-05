// Camino COMPLETO de "Entrar con Google", con las piezas reales (API, servicio de
// solicitudes, bot, cliente.service):
//   token de Google -> /api/auth/google -> (sin vincular) deep link -> bot "Sí" ->
//   /api/auth/telegram/status -> sesión -> próxima vez entra directo con Google.
// Solo se simulan Telegram y la verificación de la firma de Google.

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
  AUTHORIZED_USER_ID: 1111, JWT_SECRET: 'test-secret-e2e-google', ALLOWED_EMAILS: [], CODIGO_EXPIRACION_HORAS: 24,
  MAX_INTENTOS_CODIGO: 5, USE_SUPABASE: false, CLIENTES_FILE: '/tmp/clientes_e2e_google_test.json',
  SPREADSHEET_ID: 'sheet-test', DASHBOARD_API_PORT: 0, SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/services/registration.service', () => ({ handleStart: jest.fn(async () => ({ message: 'REGISTRO' })) }));

process.env.GOOGLE_CLIENT_ID = 'cliente-test.apps.googleusercontent.com';

const botInfo = require('../src/lib/bot-info');
const clienteService = require('../src/services/cliente.service');
const loginTelegram = require('../src/services/login-telegram.service');
const loginGoogle = require('../src/services/login-google.service');
const { app } = require('../src/api/index.js');
require('../src/handlers/commands/start');
require('../src/handlers/commands/google');
require('../src/handlers/login-actions');

const accion = () => mockActions.find((a) => String(a.re).includes('login_'));

// "Google" firma tokens de la forma  token:<sub>:<email>[:noverificado]
loginGoogle._setVerificador(async (credential, audiencia) => {
  expect(audiencia).toBe('cliente-test.apps.googleusercontent.com');
  const [tipo, sub, email, flag] = credential.split(':');
  if (tipo !== 'token') throw new Error('firma inválida');
  return { sub, email, email_verified: flag !== 'noverificado', name: 'Persona Test' };
});

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});
afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => {
  loginTelegram._reiniciar();
  botInfo._reiniciarCache();
  jest.clearAllMocks();
  clienteService.clientes = {
    '2222': { email: 'owner@test.com', sheetId: 'sheet-owner', usuarios: [], permisos: {} },
    '3333': { email: 'otra@test.com', sheetId: 'sheet-otra', usuarios: [], permisos: {} },
  };
});

async function post(path, body, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json() };
}
const google = (credential) => post('/api/auth/google', { credential });

async function abrirDeepLinkEnTelegram(deepLink, userId) {
  const payload = new URL(deepLink).searchParams.get('start');
  const ctx = { from: { id: userId }, chat: { type: 'private' }, message: { text: `/start ${payload}` }, reply: jest.fn().mockResolvedValue(true) };
  await mockCmds.start(ctx);
  return ctx;
}
async function tocar(ctxStart, userId, indiceBoton) {
  const data = ctxStart.reply.mock.calls[0][1].reply_markup.inline_keyboard.flat()[indiceBoton].callback_data;
  const ctx = { from: { id: userId }, chat: { type: 'private' }, match: accion().re.exec(data), answerCbQuery: jest.fn().mockResolvedValue(true), editMessageText: jest.fn().mockResolvedValue(true) };
  await accion().h(ctx);
  return ctx;
}

test('GET /api/auth/config ofrece Google solo si hay Client ID', async () => {
  const res = await fetch(`${baseUrl}/api/auth/config`);
  expect(await res.json()).toEqual({ googleClientId: 'cliente-test.apps.googleusercontent.com' });
});

test('camino feliz: primer ingreso se vincula en el bot; el segundo entra directo', async () => {
  // 1) Google sin vincular -> pedido de vínculo (nunca una sesión)
  const r1 = await google('token:SUB-ANA:ana@gmail.com');
  expect(r1.status).toBe(200);
  expect(r1.body.estado).toBe('vincular');
  expect(r1.body.token).toBeUndefined();
  expect(r1.body.deepLink).toBe(`https://t.me/cashy_e2e_bot?start=login_${r1.body.id}`);
  expect(JSON.stringify(r1.body)).not.toContain('SUB-ANA'); // el sub no sale del servidor

  // 2) en el bot ve QUÉ cuenta de Google se vincula
  const ctxStart = await abrirDeepLinkEnTelegram(r1.body.deepLink, 2222);
  expect(ctxStart.reply.mock.calls[0][0]).toContain('ana@gmail.com');
  expect(ctxStart.reply.mock.calls[0][0]).toContain('Vincular');

  // 3) mientras no confirme, el navegador espera
  expect((await post('/api/auth/telegram/status', { id: r1.body.id, secret: r1.body.secret })).body).toEqual({ estado: 'pendiente' });
  expect(clienteService.buscarPorGoogleSub('SUB-ANA')).toBeNull();

  // 4) confirma -> queda vinculada A QUIEN TOCÓ EL BOTÓN y el navegador recibe la sesión
  await tocar(ctxStart, 2222, 0);
  expect(clienteService.buscarPorGoogleSub('SUB-ANA')).toBe('2222');
  const st = await post('/api/auth/telegram/status', { id: r1.body.id, secret: r1.body.secret });
  expect(st.body.estado).toBe('aprobada');
  expect(st.body.user.userId).toBe('2222');

  // 5) la próxima vez entra directo, sin Telegram
  const r2 = await google('token:SUB-ANA:ana@gmail.com');
  expect(r2.body.estado).toBe('aprobada');
  expect(r2.body.user.userId).toBe('2222');
  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${r2.body.token}` } });
  expect((await me.json()).user.userId).toBe('2222');
});

test('el email NO identifica a nadie: mismo email que un perfil, pero sin vincular, no entra', async () => {
  const r = await google('token:SUB-OTRO:owner@test.com');
  expect(r.body.estado).toBe('vincular');
  expect(r.body.token).toBeUndefined();
});

test('"No fui yo" no vincula nada ni da sesión', async () => {
  const r = await google('token:SUB-X:x@gmail.com');
  const ctxStart = await abrirDeepLinkEnTelegram(r.body.deepLink, 2222);
  await tocar(ctxStart, 2222, 1);
  expect(clienteService.buscarPorGoogleSub('SUB-X')).toBeNull();
  expect((await post('/api/auth/telegram/status', { id: r.body.id, secret: r.body.secret })).body).toEqual({ estado: 'rechazada' });
});

test('una cuenta de Google ya vinculada a otra persona no se puede vincular a una segunda', async () => {
  clienteService.clientes['3333'].googleSub = 'SUB-ANA';
  const r = await google('token:SUB-ANA:ana@gmail.com');
  expect(r.body.estado).toBe('aprobada'); // entra como 3333, su dueña
  expect(r.body.user.userId).toBe('3333');
});

test('una persona con otra cuenta de Google ya vinculada no puede sumar una segunda', async () => {
  clienteService.clientes['2222'].googleSub = 'SUB-VIEJA';
  const r = await google('token:SUB-NUEVA:nueva@gmail.com');
  const ctxStart = await abrirDeepLinkEnTelegram(r.body.deepLink, 2222);
  const ctx = await tocar(ctxStart, 2222, 0);
  expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/otra cuenta de Google/);
  expect(clienteService.clientes['2222'].googleSub).toBe('SUB-VIEJA');
  expect((await post('/api/auth/telegram/status', { id: r.body.id, secret: r.body.secret })).body.estado).toBe('rechazada');
});

test('credencial inválida, email sin verificar o ausente: nunca hay sesión ni 401', async () => {
  for (const credential of ['basura', 'token:S:a@b.com:noverificado', '', undefined, 'x'.repeat(5000)]) {
    const r = await google(credential);
    expect(r.status).toBe(200);
    expect(['invalida', 'email_no_verificado']).toContain(r.body.estado);
    expect(r.body.token).toBeUndefined();
  }
});

test('quien tocó el botón es quien queda vinculado, aunque otro haya abierto el link', async () => {
  const r = await google('token:SUB-Z:z@gmail.com');
  const ctxStart = await abrirDeepLinkEnTelegram(r.body.deepLink, 3333);
  await tocar(ctxStart, 3333, 0);
  expect(clienteService.buscarPorGoogleSub('SUB-Z')).toBe('3333');
});

test('una cuenta no registrada en Cashy no puede vincular', async () => {
  const r = await google('token:SUB-W:w@gmail.com');
  const ctxStart = await abrirDeepLinkEnTelegram(r.body.deepLink, 9999);
  expect(ctxStart.reply.mock.calls[0][0]).toMatch(/no está registrada/);
  expect(clienteService.buscarPorGoogleSub('SUB-W')).toBeNull();
});

test('/google desvincular quita el vínculo y Google deja de entrar directo', async () => {
  clienteService.clientes['2222'].googleSub = 'SUB-ANA';
  const ctx = { from: { id: 2222 }, chat: { type: 'private' }, message: { text: '/google desvincular' }, reply: jest.fn().mockResolvedValue(true) };
  await mockCmds.google(ctx);
  expect(ctx.reply.mock.calls[0][0]).toMatch(/quité/);
  expect(clienteService.buscarPorGoogleSub('SUB-ANA')).toBeNull();
  expect((await google('token:SUB-ANA:ana@gmail.com')).body.estado).toBe('vincular');
});
