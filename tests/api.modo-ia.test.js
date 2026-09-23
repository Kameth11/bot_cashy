jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } },
}));

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  JWT_SECRET: 'test-secret-modo-ia',
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  USE_SUPABASE: false,
  CLIENTES_FILE: '/tmp/clientes_modo_ia_test.json',
  SPREADSHEET_ID: 'sheet-test',
  DASHBOARD_API_PORT: 0,
  SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));

// owner 2222 (modoFullIA false) con invitado 3333; usuario 9999 no registrado
jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': {
        email: 'owner@test.com',
        sheetId: 'sheet-owner',
        usuarios: [3333],
        modoFullIA: false,
      },
    };
  },
  cargarClientes: jest.fn().mockResolvedValue({}),
  guardarClientes: jest.fn().mockResolvedValue(undefined),
  getCliente: jest.fn(),
  eliminarCliente: jest.fn(),
  getPermisos: jest.fn(),
  setPermisos: jest.fn().mockResolvedValue(undefined),
  setModoFullIA: jest.fn().mockResolvedValue(true),
}));

const clienteService = require('../src/services/cliente.service');
const { app, JWT_SECRET } = require('../src/api/index.js');

const crypto = require('crypto');
function makeToken(userId) {
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

async function postModoIA(enabled, userId) {
  return fetch(`${baseUrl}/api/config/modo-ia`, {
    method: 'POST',
    headers: { ...authHeader(userId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

describe('POST /api/config/modo-ia', () => {
  test('sin token → 401', async () => {
    const res = await fetch(`${baseUrl}/api/config/modo-ia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(401);
  });

  test('owner (2222) activa el modo → 200 y setModoFullIA se llama con su propio ownerId', async () => {
    const res = await postModoIA(true, 2222);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ modoFullIA: true });
    expect(clienteService.setModoFullIA).toHaveBeenCalledWith('2222', true);
  });

  test('invitado (3333) activa el modo → setModoFullIA se llama con el ownerId del dueño (2222), no el suyo', async () => {
    const res = await postModoIA(true, 3333);
    expect(res.status).toBe(200);
    expect(clienteService.setModoFullIA).toHaveBeenCalledWith('2222', true);
  });

  test('usuario no registrado (9999) → 404', async () => {
    const res = await postModoIA(true, 9999);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/auth/me incluye modoFullIA', () => {
  test('owner (2222) recibe modoFullIA del cliente', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeader(2222) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toHaveProperty('modoFullIA', false);
  });

  test('usuario no registrado (9999) recibe modoFullIA false por default', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeader(9999) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toHaveProperty('modoFullIA', false);
  });
});
