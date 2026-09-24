// Ítem 2.4: _movCache (cache de 30s de /api/movimientos) estaba keyeada por
// userId. El dueño y su invitado comparten el mismo sheet, así que antes de
// este fix cada uno tenía su propia entrada de cache para los MISMOS datos:
// si el dueño cargaba/editaba un movimiento, la cache del invitado no se
// invalidaba (y viceversa), y el invitado podía seguir viendo datos viejos
// hasta que expirara el TTL.

jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } },
}));

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  JWT_SECRET: 'test-secret-movcache',
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  USE_SUPABASE: false,
  CLIENTES_FILE: '/tmp/clientes_movcache_test.json',
  SPREADSHEET_ID: 'sheet-test',
  DASHBOARD_API_PORT: 0,
  SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));

// owner 2222 e invitado 3333, ambos con TODOS los permisos, comparten el
// mismo sheetId — lo que importa acá es que resuelven al mismo ownerId.
jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': {
        email: 'owner@test.com',
        sheetId: 'sheet-compartido',
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

jest.mock('../src/services/sheet.service', () => ({
  obtenerDatosSheet: jest.fn().mockResolvedValue([]),
  getSheetId: jest.fn((userId) => {
    if (String(userId) === '2222' || String(userId) === '3333') return 'sheet-compartido';
    return null;
  }),
}));

const { obtenerDatosSheet } = require('../src/services/sheet.service');
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

async function getMovimientos(userId) {
  return fetch(`${baseUrl}/api/movimientos`, { headers: authHeader(userId) });
}

describe('_movCache — el dueño y su invitado comparten la misma entrada (mismo sheet)', () => {
  beforeEach(() => {
    obtenerDatosSheet.mockClear();
  });

  test('el invitado reusa la cache que ya pobló el dueño: no pide el sheet de nuevo', async () => {
    const res1 = await getMovimientos(2222);
    expect(res1.status).toBe(200);
    expect(obtenerDatosSheet).toHaveBeenCalledTimes(1);

    const res2 = await getMovimientos(3333);
    expect(res2.status).toBe(200);
    expect(obtenerDatosSheet).toHaveBeenCalledTimes(1); // sigue en 1: reusó la cache del dueño
  });
});
