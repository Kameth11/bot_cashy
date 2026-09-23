// Ítem 1.4: los códigos de acceso al dashboard valían 24 horas y no se
// invalidaban tras intentos fallidos (fuerza bruta viable sobre un código de
// 6 dígitos numéricos). Ahora: 10 minutos de validez, y el código se
// invalida a los 5 intentos fallidos (MAX_INTENTOS_CODIGO, el mismo límite
// que ya usa el flujo de /unir).

jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } },
}));

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  JWT_SECRET: 'test-secret-auth-code-attempts',
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  MAX_INTENTOS_CODIGO: 5,
  USE_SUPABASE: false,
  CLIENTES_FILE: '/tmp/clientes_auth_code_attempts_test.json',
  SPREADSHEET_ID: 'sheet-test',
  DASHBOARD_API_PORT: 0,
  SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));

jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': { email: 'owner@test.com', sheetId: 'sheet-owner', usuarios: [] },
    };
  },
  cargarClientes: jest.fn().mockResolvedValue({}),
  guardarClientes: jest.fn().mockResolvedValue(undefined),
  getCliente: jest.fn(),
  eliminarCliente: jest.fn(),
  getPermisos: jest.fn(),
  setPermisos: jest.fn().mockResolvedValue(undefined),
}));

const { bot } = require('../src/lib/telegraf');
const { app } = require('../src/api/index.js');

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

async function requestCode(userId) {
  return fetch(`${baseUrl}/api/auth/request-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}

async function verify(userId, code) {
  return fetch(`${baseUrl}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, code }),
  });
}

describe('Validez del código de acceso: 10 minutos, no 24 horas', () => {
  test('el mensaje de Telegram avisa "Vence en 10 minutos"', async () => {
    bot.telegram.sendMessage.mockClear();
    const res = await requestCode(1111);
    expect(res.status).toBe(200);

    const [, mensaje] = bot.telegram.sendMessage.mock.calls[0];
    expect(mensaje).toContain('Vence en 10 minutos');
    expect(mensaje).not.toContain('24 horas');
  });

  test('el código guardado expira en ~10 minutos, no en 24 horas', async () => {
    await requestCode(1111);
    const codeData = global._authCodes.get('1111');
    const minutosParaExpirar = (codeData.expiresAt.getTime() - Date.now()) / 60000;

    expect(minutosParaExpirar).toBeGreaterThan(9);
    expect(minutosParaExpirar).toBeLessThanOrEqual(10);
  });
});

describe('El código se invalida a los 5 intentos fallidos', () => {
  test('4 intentos incorrectos devuelven "Codigo incorrecto" sin invalidar el código', async () => {
    await requestCode(2222);
    const codeReal = global._authCodes.get('2222').code;
    const codeIncorrecto = codeReal === '000000' ? '111111' : '000000';

    for (let i = 0; i < 4; i++) {
      const res = await verify(2222, codeIncorrecto);
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe('Codigo incorrecto');
    }

    // El código real todavía sirve: no se invalidó antes de tiempo.
    const okRes = await verify(2222, codeReal);
    expect(okRes.status).toBe(200);
  });

  test('el 5to intento incorrecto invalida el código, incluso para el valor correcto después', async () => {
    // userId distinto del test anterior: el rate limiter de /api/auth/verify
    // es por telegramId (máx 10 cada 10 min) y ya gastamos 5 ahí.
    await requestCode(1111);
    const codeReal = global._authCodes.get('1111').code;
    const codeIncorrecto = codeReal === '000000' ? '111111' : '000000';

    let ultimaRes;
    for (let i = 0; i < 5; i++) {
      ultimaRes = await verify(1111, codeIncorrecto);
    }
    const ultimoBody = await ultimaRes.json();
    expect(ultimaRes.status).toBe(400);
    expect(ultimoBody.error).toMatch(/agotaron los intentos/i);

    // Ni siquiera el código correcto sirve ya: quedó invalidado.
    const resConCodigoCorrecto = await verify(1111, codeReal);
    const bodyCorrecto = await resConCodigoCorrecto.json();
    expect(resConCodigoCorrecto.status).toBe(400);
    expect(bodyCorrecto.error).toMatch(/demasiados intentos/i);
  });
});
