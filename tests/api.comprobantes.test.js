// Fase 3 de PLAN_COMPROBANTES.md: el dashboard lista comprobantes y baja el
// archivo por la API (nunca por una URL del bucket). Los del ámbito personal
// son solo del dueño/admin, igual que /api/personal/*.

jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } },
}));

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  JWT_SECRET: 'test-secret-comprobantes',
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  USE_SUPABASE: false,
  CLIENTES_FILE: '/tmp/clientes_comprobantes_test.json',
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
        usuarios: [3333, 4444],
        permisos: {
          '3333': ['ver_movimientos', 'cargar_movimientos'],
          '4444': ['ver_agenda'],
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

const COMPROBANTES = [
  { id: 'comp_1', tipo: 'factura', ambito: 'consultorio', emisor: 'Dental Sur', total: 45300, moneda: 'Pesos', idMovimiento: 'mov_1', items: [], archivo: 'sb:t1/2026-09/comp_1.jpg', mimeType: 'image/jpeg', hash: 'h1' },
  { id: 'comp_2', tipo: 'factura', ambito: 'personal', emisor: 'Coto', total: 20000, moneda: 'Pesos', idMovimiento: 'pmov_1', items: [], archivo: 'tg:f2', mimeType: 'image/jpeg' },
  { id: 'comp_3', tipo: 'transferencia', ambito: 'consultorio', emisor: 'Juan', total: 30000, moneda: 'Pesos', idMovimiento: '', items: [], archivo: '', mimeType: '' },
];

jest.mock('../src/services/comprobante.service', () => ({
  listarComprobantes: jest.fn(async () => COMPROBANTES),
}));

jest.mock('../src/services/comprobante-archivo.service', () => ({
  descargarArchivo: jest.fn(async () => Buffer.from('JPEGDATA')),
}));

const { app, JWT_SECRET } = require('../src/api/index.js');
const { descargarArchivo } = require('../src/services/comprobante-archivo.service');

const crypto = require('crypto');
function makeToken(userId) {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ userId: String(userId), type: 'dashboard', iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

let server, baseUrl;
beforeAll(async () => {
  await new Promise(resolve => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(() => jest.clearAllMocks());

const get = (path, userId) => fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${makeToken(userId)}` } });

test('el dueño ve todos, sin exponer hash ni la ruta interna del archivo', async () => {
  const res = await get('/api/comprobantes', 2222);
  expect(res.status).toBe(200);
  const { comprobantes } = await res.json();
  expect(comprobantes.map(c => c.id)).toEqual(['comp_1', 'comp_2', 'comp_3']);
  expect(comprobantes[0]).toMatchObject({ tieneArchivo: true, idMovimiento: 'mov_1' });
  expect(comprobantes[2].tieneArchivo).toBe(false);
  expect(comprobantes[0].archivo).toBeUndefined();
  expect(comprobantes[0].hash).toBeUndefined();
});

test('un invitado con ver_movimientos no ve los personales del dueño', async () => {
  const { comprobantes } = await (await get('/api/comprobantes', 3333)).json();
  expect(comprobantes.map(c => c.id)).toEqual(['comp_1', 'comp_3']);
});

test('sin ver_movimientos: 403', async () => {
  expect((await get('/api/comprobantes', 4444)).status).toBe(403);
  expect((await get('/api/comprobantes/comp_1/archivo', 4444)).status).toBe(403);
});

test('baja el archivo con su content-type', async () => {
  const res = await get('/api/comprobantes/comp_1/archivo', 3333);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/jpeg');
  expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('JPEGDATA');
  expect(descargarArchivo).toHaveBeenCalledWith('3333', 'sb:t1/2026-09/comp_1.jpg');
});

test('un invitado no puede bajar el archivo de un comprobante personal', async () => {
  expect((await get('/api/comprobantes/comp_2/archivo', 3333)).status).toBe(404);
  expect(descargarArchivo).not.toHaveBeenCalled();
});

test('comprobante sin archivo o inexistente: 404', async () => {
  expect((await get('/api/comprobantes/comp_3/archivo', 2222)).status).toBe(404);
  expect((await get('/api/comprobantes/nada/archivo', 2222)).status).toBe(404);
});
