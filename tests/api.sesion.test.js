// Ítem 8 de la auditoría: sesión del dashboard más corta, con tope absoluto, y
// que se corta al sacar al usuario del sistema.

jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: jest.fn() } } }));
let mockClientes = { '2222': { email: 'o@x.com', sheetId: 's', usuarios: [], permisos: {} } };
jest.mock('../src/services/cliente.service', () => ({
  get clientes() { return mockClientes; },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(), eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const { app, JWT_SECRET, firmarSesion, SESSION_MAX_SEC } = require('../src/api/index.js');

let server, base;
beforeAll(async () => { await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }); });
afterAll(() => new Promise(r => server.close(r)));
beforeEach(() => { mockClientes = { '2222': { email: 'o@x.com', sheetId: 's', usuarios: [], permisos: {} } }; });

const me = (token) => fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
const ahora = () => Math.floor(Date.now() / 1000);

test('el token nuevo dura días, no meses, y trae authAt', () => {
  const d = jwt.decode(firmarSesion(2222));
  expect(d.exp - d.iat).toBe(14 * 24 * 3600);
  expect(d.authAt).toBeGreaterThan(0);
});

test('usuario registrado: 200', async () => {
  expect((await me(firmarSesion(2222))).status).toBe(200);
});

test('usuario que ya no está en el sistema: 401 aunque el token sea válido', async () => {
  const token = firmarSesion(2222);
  mockClientes = {}; // /salir, /accesos o DELETE /api/users
  expect((await me(token)).status).toBe(401);
});

test('la renovación deslizante conserva authAt (no alarga el login original)', async () => {
  const authAt = ahora() - 30 * 24 * 3600;
  // Token a punto de vencer: obliga a renovar.
  const casiVencido = jwt.sign({ userId: '2222', type: 'dashboard', authAt }, JWT_SECRET, { expiresIn: 3600 });
  const res = await me(casiVencido);
  expect(res.status).toBe(200);
  const renovado = jwt.decode(res.headers.get('x-refreshed-token'));
  expect(renovado.authAt).toBe(authAt);
  expect(renovado.exp - renovado.iat).toBe(14 * 24 * 3600);
});

test('pasado el tope absoluto (90 días) hay que volver a loguearse, aunque se use todos los días', async () => {
  const vieja = jwt.sign({ userId: '2222', type: 'dashboard', authAt: ahora() - SESSION_MAX_SEC - 60 }, JWT_SECRET, { expiresIn: '14d' });
  const res = await me(vieja);
  expect(res.status).toBe(401);
  expect((await res.json()).error).toMatch(/Sesión vencida/);
});

test('token viejo (sin authAt): sigue valiendo y se migra con un token nuevo, sin sacar a nadie de la sesión', async () => {
  // Un token de hace 120 días: por su iat pasaría el tope de 90, pero no debe cortarse.
  const viejo = jwt.sign({ userId: '2222', type: 'dashboard', iat: ahora() - 120 * 24 * 3600 }, JWT_SECRET, { expiresIn: '180d' });
  const res = await me(viejo);
  expect(res.status).toBe(200);
  const nuevo = jwt.decode(res.headers.get('x-refreshed-token'));
  expect(nuevo.authAt).toBeGreaterThan(ahora() - 60);
  expect(nuevo.exp - nuevo.iat).toBe(14 * 24 * 3600);
});
