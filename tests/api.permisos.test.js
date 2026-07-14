jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } },
}));

// Mock config con admin conocido
jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  JWT_SECRET: 'test-secret-permisos',
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  USE_SUPABASE: false,
  CLIENTES_FILE: '/tmp/clientes_permisos_test.json',
  SPREADSHEET_ID: 'sheet-test',
  DASHBOARD_API_PORT: 0,
  SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));

// Mock clientes: owner 2222, invitado 3333 (solo agenda), invitado 4444 (recepcion)
jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': {
        email: 'owner@test.com',
        sheetId: 'sheet-owner',
        usuarios: [3333, 4444],
        permisos: {
          '3333': ['ver_agenda', 'editar_agenda'],
          '4444': ['ver_agenda', 'editar_agenda', 'ver_movimientos', 'cargar_movimientos', 'editar_movimientos', 'ver_balance'],
        },
      },
    };
  },
  cargarClientes: jest.fn().mockResolvedValue({}),
  guardarClientes: jest.fn().mockResolvedValue(undefined),
  getCliente: jest.fn(),
  eliminarCliente: jest.fn(),
  getPermisos: jest.fn(),
  setPermisos: jest.fn().mockResolvedValue(undefined),
}));

const { app, JWT_SECRET } = require('../src/api/index.js');

// Generamos tokens firmados con el mismo secreto que usa la API en test
const crypto = require('crypto');
function makeToken(userId) {
  // Construir JWT manualmente para no depender de jsonwebtoken en el test
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ userId: String(userId), type: 'dashboard', iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function authHeader(userId) {
  return { Authorization: `Bearer ${makeToken(userId)}` };
}

let server, baseUrl;

beforeAll(async () => {
  await new Promise(resolve => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function get(path, userId) {
  return fetch(`${baseUrl}${path}`, { headers: authHeader(userId) });
}

// ── ver_movimientos ──
describe('GET /api/movimientos — requiere ver_movimientos', () => {
  test('admin (1111) recibe 200 o 500 (no 403)', async () => {
    const res = await get('/api/movimientos', 1111);
    expect(res.status).not.toBe(403);
  });

  test('owner (2222) recibe 200 o 500 (no 403)', async () => {
    const res = await get('/api/movimientos', 2222);
    expect(res.status).not.toBe(403);
  });

  test('invitado recepcion (4444) tiene ver_movimientos → no 403', async () => {
    const res = await get('/api/movimientos', 4444);
    expect(res.status).not.toBe(403);
  });

  test('invitado solo-agenda (3333) no tiene ver_movimientos → 403', async () => {
    const res = await get('/api/movimientos', 3333);
    expect(res.status).toBe(403);
  });
});

// ── ver_balance ──
describe('GET /api/metrics — requiere ver_balance', () => {
  test('admin (1111) → no 403', async () => {
    const res = await get('/api/metrics', 1111);
    expect(res.status).not.toBe(403);
  });

  test('invitado solo-agenda (3333) → 403', async () => {
    const res = await get('/api/metrics', 3333);
    expect(res.status).toBe(403);
  });

  test('invitado recepcion (4444) tiene ver_balance → no 403', async () => {
    const res = await get('/api/metrics', 4444);
    expect(res.status).not.toBe(403);
  });
});

// ── ver_agenda ──
describe('GET /api/agenda — requiere ver_agenda', () => {
  test('invitado solo-agenda (3333) tiene ver_agenda → no 403', async () => {
    const res = await get('/api/agenda', 3333);
    expect(res.status).not.toBe(403);
  });

  test('usuario desconocido solo recibe DEFAULT_PERMISOS (ver_agenda) → no 403 en agenda', async () => {
    const res = await get('/api/agenda', 9999);
    // 9999 no es miembro, así que resolverPermisos da DEFAULT_PERMISOS = ['ver_agenda']
    expect(res.status).not.toBe(403);
  });
});

// ── cobrado requiere cargar_movimientos ──
describe('PATCH /api/agenda/:id/cobrado — requiere cargar_movimientos', () => {
  test('invitado solo-agenda (3333) → 403', async () => {
    const res = await fetch(`${baseUrl}/api/agenda/turno-fake/cobrado`, {
      method: 'PATCH',
      headers: { ...authHeader(3333), 'Content-Type': 'application/json' },
      body: JSON.stringify({ montoTotal: 100, pagos: [{ metodoPago: 'efectivo', monto: 100 }] }),
    });
    expect(res.status).toBe(403);
  });

  test('invitado recepcion (4444) tiene cargar_movimientos → no 403', async () => {
    const res = await fetch(`${baseUrl}/api/agenda/turno-fake/cobrado`, {
      method: 'PATCH',
      headers: { ...authHeader(4444), 'Content-Type': 'application/json' },
      body: JSON.stringify({ montoTotal: 100, pagos: [{ metodoPago: 'efectivo', monto: 100 }] }),
    });
    // Puede ser 404 (turno no existe) pero no 403
    expect(res.status).not.toBe(403);
  });
});
