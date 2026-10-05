// Límites del login con Telegram. Va en su propio archivo: el limiter es en
// memoria y por proceso, así que necesita arrancar con el contador en cero.

jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true), getMe: jest.fn().mockResolvedValue({ username: 'cashy_test_bot' }) } },
}));
jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111, JWT_SECRET: 'test-secret-auth-telegram-rl', ALLOWED_EMAILS: [], CODIGO_EXPIRACION_HORAS: 24,
  MAX_INTENTOS_CODIGO: 5, USE_SUPABASE: false, CLIENTES_FILE: '/tmp/clientes_auth_telegram_rl_test.json',
  SPREADSHEET_ID: 'sheet-test', DASHBOARD_API_PORT: 0, SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));
jest.mock('../src/services/cliente.service', () => ({
  get clientes() { return {}; },
  cargarClientes: jest.fn().mockResolvedValue({}), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

const loginTelegram = require('../src/services/login-telegram.service');
const { app } = require('../src/api/index.js');

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});
afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => loginTelegram._reiniciar());

const post = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

test('crear solicitudes: tope por IP (20 cada 10 min) y después 429', async () => {
  const estados = [];
  for (let i = 0; i < 22; i++) estados.push((await post('/api/auth/telegram/start')).status);
  expect(estados.slice(0, 20).every((s) => s === 201)).toBe(true);
  expect(estados.slice(20)).toEqual([429, 429]);
});

test('el polling tiene su propio límite por solicitud (200 cada 10 min), holgado para esperar 5 minutos', async () => {
  const id = 'a'.repeat(22);
  const estados = [];
  for (let i = 0; i < 205; i++) estados.push((await post('/api/auth/telegram/status', { id, secret: 'x' })).status);
  expect(estados.slice(0, 200).every((s) => s === 200)).toBe(true); // ≈ 1 consulta cada 1,5 s durante 5 min entra de sobra
  expect(estados.slice(200).every((s) => s === 429)).toBe(true);
});
