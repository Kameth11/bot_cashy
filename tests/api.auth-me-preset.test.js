// /api/auth/me devuelve el nombre de la plantilla de permisos (preset) calculado por el servidor, para que el
// dashboard no tenga que copiar la lista de plantillas (antes ConfigPage la repetía a mano).

jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } } }));
jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  JWT_SECRET: 'test-secret-preset',
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  USE_SUPABASE: false,
  CLIENTES_FILE: '/tmp/clientes_preset_test.json',
  SPREADSHEET_ID: 'sheet-test',
  DASHBOARD_API_PORT: 0,
  SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));

jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': {
        email: 'owner@test.com',
        sheetId: 'sheet-owner',
        usuarios: [3333, 4444, 5555],
        permisos: {
          '3333': ['ver_agenda', 'editar_agenda'], // = odontologo
          '4444': ['ver_agenda', 'editar_agenda', 'ver_movimientos', 'cargar_movimientos', 'editar_movimientos', 'ver_balance'], // = recepcion
          '5555': ['ver_agenda', 'ver_balance'], // a medida
        },
      },
    };
  },
  cargarClientes: jest.fn().mockResolvedValue({}), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

const crypto = require('crypto');
const { app, JWT_SECRET } = require('../src/api/index.js');

function authHeader(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ userId: String(userId), type: 'dashboard', iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return { Authorization: `Bearer ${header}.${payload}.${sig}` };
}

let server, baseUrl;
beforeAll(async () => {
  await new Promise(resolve => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

async function me(userId) {
  const res = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeader(userId) });
  expect(res.status).toBe(200);
  return (await res.json()).user;
}

test.each([
  [3333, 'odontologo'],
  [4444, 'recepcion'],
  [5555, null],
])('usuario %s → preset %s', async (userId, esperado) => {
  expect((await me(userId)).preset).toBe(esperado);
});
