// Ítem 1.3: DASHBOARD_DEV_TOKEN dejaba entrar como CUALQUIER usuario (incluido
// el admin) a quien conociera ese valor, sin importar el entorno, y con una
// comparación === (vulnerable a timing attack). Ahora: solo funciona con
// NODE_ENV=development, comparación con crypto.timingSafeEqual, y advierte al
// arrancar si la variable quedó seteada fuera de development.

jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } },
}));

jest.mock('../src/lib/logger', () => ({
  audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  JWT_SECRET: 'test-secret-dev-token',
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  USE_SUPABASE: false,
  CLIENTES_FILE: '/tmp/clientes_dev_token_test.json',
  SPREADSHEET_ID: 'sheet-test',
  DASHBOARD_API_PORT: 0,
  SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));

jest.mock('../src/services/cliente.service', () => ({
  get clientes() { return {}; },
  cargarClientes: jest.fn().mockResolvedValue({}),
  guardarClientes: jest.fn().mockResolvedValue(undefined),
  getCliente: jest.fn(),
  eliminarCliente: jest.fn(),
  getPermisos: jest.fn(),
  setPermisos: jest.fn().mockResolvedValue(undefined),
}));

const logger = require('../src/lib/logger');
const { app, warnIfDevTokenMisconfigured } = require('../src/api/index.js');

let server, baseUrl;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DEV_TOKEN = process.env.DASHBOARD_DEV_TOKEN;

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
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_DEV_TOKEN === undefined) delete process.env.DASHBOARD_DEV_TOKEN; else process.env.DASHBOARD_DEV_TOKEN = ORIGINAL_DEV_TOKEN;
});

async function verify(userId, code) {
  return fetch(`${baseUrl}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, code }),
  });
}

describe('DASHBOARD_DEV_TOKEN solo funciona con NODE_ENV=development', () => {
  test('development + token correcto → login exitoso', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DASHBOARD_DEV_TOKEN = 'super-secreto-dev';

    const res = await verify(555001, 'super-secreto-dev');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.token).toBeTruthy();
    expect(body.user.userId).toBe('555001');
  });

  test('development + token incorrecto → NO loguea (cae al flujo normal de código)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DASHBOARD_DEV_TOKEN = 'super-secreto-dev';

    const res = await verify(555002, 'otro-valor-cualquiera');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.token).toBeUndefined();
  });

  test('producción (NODE_ENV != development) + token que coincide → NO loguea aunque el valor sea correcto', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DASHBOARD_DEV_TOKEN = 'super-secreto-dev';

    const res = await verify(555003, 'super-secreto-dev');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.token).toBeUndefined();
  });

  test('NODE_ENV sin definir + token que coincide → NO loguea', async () => {
    delete process.env.NODE_ENV;
    process.env.DASHBOARD_DEV_TOKEN = 'super-secreto-dev';

    const res = await verify(555004, 'super-secreto-dev');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.token).toBeUndefined();
  });

  test('admin: no puede loguearse como admin vía dev token fuera de development', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DASHBOARD_DEV_TOKEN = 'super-secreto-dev';

    const res = await verify(1111, 'super-secreto-dev');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.token).toBeUndefined();
  });
});

describe('Advertencia al arrancar la API si DASHBOARD_DEV_TOKEN queda seteado fuera de development', () => {
  // warnIfDevTokenMisconfigured() es la parte de startApi() que nos importa acá
  // (no requiere abrir un socket real).
  test('DEV_TOKEN seteado + NODE_ENV=production → logger.warn', () => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    process.env.DASHBOARD_DEV_TOKEN = 'algo';
    warnIfDevTokenMisconfigured();
    expect(logger.warn).toHaveBeenCalledWith('API', expect.stringContaining('NODE_ENV'));
  });

  test('DEV_TOKEN seteado + NODE_ENV=development → sin advertencia', () => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
    process.env.DASHBOARD_DEV_TOKEN = 'algo';
    warnIfDevTokenMisconfigured();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('sin DEV_TOKEN seteado → sin advertencia, sin importar el entorno', () => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    delete process.env.DASHBOARD_DEV_TOKEN;
    warnIfDevTokenMisconfigured();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
