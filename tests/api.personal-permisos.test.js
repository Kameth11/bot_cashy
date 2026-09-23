// Ítem 1.2: las rutas /api/personal/* no tenían ningún control de acceso —
// cualquier invitado autenticado podía leer, cargar y borrar los
// movimientos personales, presupuestos y viajes del dueño (getSheetId
// resuelve al invitado al mismo sheet). Ahora exigen ownerOnly, igual que
// /api/accesos. Mismo patrón que tests/api.permisos.test.js.

jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } },
}));

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  JWT_SECRET: 'test-secret-personal-permisos',
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  USE_SUPABASE: false,
  CLIENTES_FILE: '/tmp/clientes_personal_permisos_test.json',
  SPREADSHEET_ID: 'sheet-test',
  DASHBOARD_API_PORT: 0,
  SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));

// owner 2222, invitado 3333 (recepción: tiene TODOS los permisos granulares,
// pero no es dueño) — para dejar claro que ownerOnly no es lo mismo que
// "tiene todos los permisos".
jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': {
        email: 'owner@test.com',
        sheetId: 'sheet-owner',
        usuarios: [3333],
        permisos: {
          '3333': ['ver_agenda', 'editar_agenda', 'ver_movimientos', 'cargar_movimientos', 'editar_movimientos', 'ver_balance'],
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

async function req(method, path, userId, body) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...authHeader(userId), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('/api/personal/* requiere ownerOnly', () => {
  test('GET /api/personal/categorias: invitado (3333) → 403 aunque tenga todos los permisos granulares', async () => {
    const res = await req('GET', '/api/personal/categorias', 3333);
    expect(res.status).toBe(403);
  });

  test('GET /api/personal/categorias: owner (2222) → no 403', async () => {
    const res = await req('GET', '/api/personal/categorias', 2222);
    expect(res.status).not.toBe(403);
  });

  test('GET /api/personal/categorias: admin (1111) → no 403', async () => {
    const res = await req('GET', '/api/personal/categorias', 1111);
    expect(res.status).not.toBe(403);
  });

  test('GET /api/personal/resumen: invitado (3333) → 403', async () => {
    const res = await req('GET', '/api/personal/resumen', 3333);
    expect(res.status).toBe(403);
  });

  test('GET /api/personal/resumen: owner (2222) → no 403 (200 o 500, nunca 403)', async () => {
    const res = await req('GET', '/api/personal/resumen', 2222);
    expect(res.status).not.toBe(403);
  });

  test('GET /api/personal/movimientos: invitado (3333) → 403', async () => {
    const res = await req('GET', '/api/personal/movimientos', 3333);
    expect(res.status).toBe(403);
  });

  test('POST /api/personal/movimientos: invitado (3333) → 403, no llega a validar body', async () => {
    const res = await req('POST', '/api/personal/movimientos', 3333, { descripcion: 'nafta', monto: 20000, tipo: 'Egreso' });
    expect(res.status).toBe(403);
  });

  test('DELETE /api/personal/movimientos/:id: invitado (3333) → 403', async () => {
    const res = await req('DELETE', '/api/personal/movimientos/mov-fake', 3333);
    expect(res.status).toBe(403);
  });

  test('GET /api/personal/presupuestos: invitado (3333) → 403', async () => {
    const res = await req('GET', '/api/personal/presupuestos', 3333);
    expect(res.status).toBe(403);
  });

  test('PUT /api/personal/presupuestos: invitado (3333) → 403', async () => {
    const res = await req('PUT', '/api/personal/presupuestos', 3333, { categoria: 'supermercado', montoMensual: 1000 });
    expect(res.status).toBe(403);
  });

  test('GET /api/personal/viajes: invitado (3333) → 403', async () => {
    const res = await req('GET', '/api/personal/viajes', 3333);
    expect(res.status).toBe(403);
  });

  test('POST /api/personal/viajes: invitado (3333) → 403', async () => {
    const res = await req('POST', '/api/personal/viajes', 3333, { nombre: 'Brasil' });
    expect(res.status).toBe(403);
  });

  test('POST /api/personal/viajes/cerrar: invitado (3333) → 403', async () => {
    const res = await req('POST', '/api/personal/viajes/cerrar', 3333);
    expect(res.status).toBe(403);
  });
});

describe('/api/auth/me expone isOwner (para que el dashboard oculte la sección Personal)', () => {
  test('owner (2222) → isOwner: true', async () => {
    const res = await req('GET', '/api/auth/me', 2222);
    const body = await res.json();
    expect(body.user.isOwner).toBe(true);
  });

  test('admin (1111) → isOwner: true', async () => {
    const res = await req('GET', '/api/auth/me', 1111);
    const body = await res.json();
    expect(body.user.isOwner).toBe(true);
  });

  test('invitado (3333) → isOwner: false', async () => {
    const res = await req('GET', '/api/auth/me', 3333);
    const body = await res.json();
    expect(body.user.isOwner).toBe(false);
  });
});
