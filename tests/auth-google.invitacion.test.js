// "Entrar con Google" con una invitación del dueño: la cuenta se crea sin pasar por Telegram.
// API real + cliente.service real (modo archivo); solo se simulan la verificación de Google y el
// servicio de invitaciones (que ya prueba invitacion-web.service.test.js). Lo que se verifica acá es
// el ENGANCHE: cuándo se canjea, qué se responde y que la sesión nueva funciona de verdad.

jest.mock('../src/lib/telegraf', () => ({
  bot: { command: jest.fn(), action: jest.fn(), telegram: { sendMessage: jest.fn(), getMe: jest.fn().mockResolvedValue({ username: 'cashy_bot' }) } },
}));
jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111, JWT_SECRET: 'test-secret-google-invitacion', ALLOWED_EMAILS: [], CODIGO_EXPIRACION_HORAS: 24,
  MAX_INTENTOS_CODIGO: 5, USE_SUPABASE: false, CLIENTES_FILE: '/tmp/clientes_google_invitacion_test.json',
  SPREADSHEET_ID: 'sheet-test', DASHBOARD_API_PORT: 0, SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/services/invitacion-web.service', () => ({
  canjearPorGoogle: jest.fn(),
  PERMISO_INVITAR: 'invitar_personas',
  DIAS_DE_VIGENCIA: 7,
  listarInvitaciones: jest.fn(),
  crearInvitacion: jest.fn(),
  revocarInvitacion: jest.fn(),
}));

process.env.GOOGLE_CLIENT_ID = 'cliente-test.apps.googleusercontent.com';

const botInfo = require('../src/lib/bot-info');
const clienteService = require('../src/services/cliente.service');
const loginTelegram = require('../src/services/login-telegram.service');
const loginGoogle = require('../src/services/login-google.service');
const invitaciones = require('../src/services/invitacion-web.service');
const { app } = require('../src/api/index.js');

loginGoogle._setVerificador(async (credential) => {
  const [tipo, sub, email] = credential.split(':');
  if (tipo !== 'token') throw new Error('firma inválida');
  return { sub, email, email_verified: true, name: 'Odontóloga Nueva' };
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
  };
});

const post = async (path, body, headers = {}) => {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json() };
};
const google = (credential) => post('/api/auth/google', { credential });
const get = async (path, token) => {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
};

// Lo que hace de verdad el servicio: alta como invitado del dueño con ID negativo.
function simularAlta(g) {
  const id = -1790000000000123;
  const key = String(id);
  clienteService.clientes[key] = { email: g.email, sheetId: 'sheet-owner', usuarios: [], permisos: {}, googleSub: g.sub };
  clienteService.clientes['2222'].usuarios = [id];
  clienteService.clientes['2222'].permisos = { [key]: ['ver_agenda', 'editar_agenda'] };
  return { ok: true, userId: key, ownerId: '2222' };
}

test('con invitación: entra directo con sesión y es invitado del dueño (sin pasar por el bot)', async () => {
  invitaciones.canjearPorGoogle.mockImplementation(async (g) => simularAlta(g));

  const r = await google('token:SUB-NUEVA:nueva@gmail.com');
  expect(r.status).toBe(200);
  expect(r.body.estado).toBe('aprobada');
  expect(r.body.bienvenida).toBe(true);
  expect(typeof r.body.token).toBe('string');
  expect(r.body.deepLink).toBeUndefined();
  expect(invitaciones.canjearPorGoogle).toHaveBeenCalledWith({ sub: 'SUB-NUEVA', email: 'nueva@gmail.com', nombre: 'Odontóloga Nueva' });

  // La sesión funciona (el ID negativo pasa la autenticación) y trae el alcance elegido.
  expect(r.body.user).toMatchObject({ userId: '-1790000000000123', isOwner: false, isAdmin: false, permisos: ['ver_agenda', 'editar_agenda'] });
  const yo = await get('/api/auth/me', r.body.token);
  expect(yo.status).toBe(200);
  expect(yo.body.user.permisos).toEqual(['ver_agenda', 'editar_agenda']);

  // Y la próxima vez entra directo, sin volver a canjear.
  invitaciones.canjearPorGoogle.mockClear();
  const r2 = await google('token:SUB-NUEVA:nueva@gmail.com');
  expect(r2.body.estado).toBe('aprobada');
  expect(r2.body.bienvenida).toBeUndefined();
  expect(invitaciones.canjearPorGoogle).not.toHaveBeenCalled();
});

test('sin invitación: sigue el camino de siempre (confirmar en el bot), nunca una sesión', async () => {
  invitaciones.canjearPorGoogle.mockResolvedValue({ ok: false, motivo: 'sin_invitacion' });
  const r = await google('token:SUB-CUALQUIERA:cualquiera@gmail.com');
  expect(r.body.estado).toBe('vincular');
  expect(r.body.token).toBeUndefined();
  expect(r.body.deepLink).toMatch(/^https:\/\/t\.me\/cashy_bot\?start=login_/);
});

test('una cuenta ya vinculada entra directo y NO consulta invitaciones', async () => {
  clienteService.clientes['2222'].googleSub = 'SUB-DUENO';
  const r = await google('token:SUB-DUENO:owner@test.com');
  expect(r.body.estado).toBe('aprobada');
  expect(invitaciones.canjearPorGoogle).not.toHaveBeenCalled();
});

test('un token de Google inválido nunca llega a canjear nada', async () => {
  const r = await google('basura');
  expect(r.body.estado).toBe('invalida');
  expect(invitaciones.canjearPorGoogle).not.toHaveBeenCalled();
});
