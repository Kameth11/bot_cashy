// Bot: /start login_<id> y los botones ✅/❌. El servicio de solicitudes es el real.

const mockCmds = {};
const mockActions = [];

jest.mock('../src/lib/telegraf', () => ({
  bot: {
    command: (name, h) => { mockCmds[name] = h; },
    action: (re, h) => { mockActions.push({ re, h }); },
  },
}));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/auth', () => ({
  esAdminOriginal: jest.fn((id) => Number(id) === 1111),
  obtenerClientePorUserId: jest.fn((id) => (Number(id) === 2222 ? { ownerId: 2222, isOwner: true } : null)),
}));
jest.mock('../src/services/registration.service', () => ({
  handleStart: jest.fn(async () => ({ message: 'BIENVENIDA', parse_mode: 'Markdown' })),
}));

const loginTelegram = require('../src/services/login-telegram.service');
const registration = require('../src/services/registration.service');
const logger = require('../src/lib/logger');
require('../src/handlers/commands/start');
const { mensajeConfirmacion, haceCuanto } = require('../src/handlers/login-actions');

const accion = mockActions.find((a) => String(a.re).includes('login_'));

function ctxStart(userId, texto, chatType = 'private') {
  return {
    from: { id: userId }, chat: { type: chatType }, message: { text: texto },
    reply: jest.fn().mockResolvedValue(true),
  };
}
function ctxBoton(userId, data, chatType = 'private') {
  const m = accion.re.exec(data);
  return {
    from: { id: userId }, chat: { type: chatType }, match: m,
    answerCbQuery: jest.fn().mockResolvedValue(true), editMessageText: jest.fn().mockResolvedValue(true),
  };
}
const botones = (ctx) => ctx.reply.mock.calls[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);

beforeEach(() => {
  jest.clearAllMocks();
  loginTelegram._reiniciar();
});

describe('/start sin payload: el registro sigue igual', () => {
  test('llama al registro de siempre', async () => {
    const ctx = ctxStart(555, '/start');
    await mockCmds.start(ctx);
    expect(registration.handleStart).toHaveBeenCalledWith(555);
    expect(ctx.reply.mock.calls[0][0]).toBe('BIENVENIDA');
  });

  test('un payload que no es de login (otro deep link) también va al registro', async () => {
    await mockCmds.start(ctxStart(555, '/start ref_abc'));
    expect(registration.handleStart).toHaveBeenCalledTimes(1);
  });
});

describe('/start login_<id>', () => {
  test('persona registrada: muestra desde dónde se pidió y los dos botones, sin tocar el registro', async () => {
    const { id } = loginTelegram.crearSolicitud({ ip: '190.1.2.3', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36' });
    const ctx = ctxStart(2222, `/start login_${id}`);
    await mockCmds.start(ctx);

    const texto = ctx.reply.mock.calls[0][0];
    expect(texto).toContain('Chrome en Windows');
    expect(texto).toContain('190.1.2.3');
    expect(texto).toContain('solo si lo pediste vos');
    expect(botones(ctx)).toEqual([`login_ok:${id}`, `login_no:${id}`]);
    expect(registration.handleStart).not.toHaveBeenCalled();
    // todavía nadie aprobó
    expect(loginTelegram.obtenerParaAprobar(id)).not.toBeNull();
  });

  test('el admin también', async () => {
    const { id } = loginTelegram.crearSolicitud();
    const ctx = ctxStart(1111, `/start login_${id}`);
    await mockCmds.start(ctx);
    expect(botones(ctx)).toHaveLength(2);
  });

  test('una persona NO registrada no entra al registro y no se aprueba nada', async () => {
    const { id } = loginTelegram.crearSolicitud();
    const ctx = ctxStart(9999, `/start login_${id}`);
    await mockCmds.start(ctx);

    expect(ctx.reply.mock.calls[0][0]).toMatch(/no está registrada/);
    expect(ctx.reply.mock.calls[0][1]).toBeUndefined(); // sin botones
    expect(registration.handleStart).not.toHaveBeenCalled(); // NO inicia un alta
    expect(loginTelegram.obtenerParaAprobar(id)).not.toBeNull();
  });

  test('en un grupo se rechaza: la aprobación es solo en el privado', async () => {
    const { id } = loginTelegram.crearSolicitud();
    const ctx = ctxStart(2222, `/start login_${id}`, 'supergroup');
    await mockCmds.start(ctx);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/conversación privada/);
    expect(ctx.reply.mock.calls[0][1]).toBeUndefined();
  });

  test('"/start@mi_bot login_<id>" (forma con @) funciona', async () => {
    const { id } = loginTelegram.crearSolicitud();
    const ctx = ctxStart(2222, `/start@mi_bot login_${id}`);
    await mockCmds.start(ctx);
    expect(botones(ctx)).toEqual([`login_ok:${id}`, `login_no:${id}`]);
  });

  test.each([
    ['login_corto'],
    ['login_'],
    ['login_' + 'a'.repeat(22)],       // formato válido pero no existe
    ['login_../../etc/passwd'],
  ])('%s: avisa que venció y NO entra al registro', async (payload) => {
    const ctx = ctxStart(2222, `/start ${payload}`);
    await mockCmds.start(ctx);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/venció o ya se usó/);
    expect(registration.handleStart).not.toHaveBeenCalled();
  });
});

describe('botones ✅ / ❌', () => {
  test('el regex solo acepta ids bien formados', () => {
    expect(accion.re.test('login_ok:' + 'a'.repeat(22))).toBe(true);
    expect(accion.re.test('login_no:' + 'a'.repeat(22))).toBe(true);
    expect(accion.re.test('login_ok:corto')).toBe(false);
    expect(accion.re.test('login_si:' + 'a'.repeat(22))).toBe(false);
    expect(accion.re.test('login_ok:' + 'a'.repeat(23))).toBe(false);
  });

  test('"Sí, soy yo" aprueba con la identidad de QUIEN TOCA el botón', async () => {
    const { id, secret } = loginTelegram.crearSolicitud();
    const ctx = ctxBoton(2222, `login_ok:${id}`);
    await accion.h(ctx);

    expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/Listo, ya podés volver al navegador/);
    expect(loginTelegram.consultar(id, secret)).toEqual({ estado: 'aprobada', userId: '2222' });
    expect(logger.audit).toHaveBeenCalledWith('auth_telegram_login_aprobado', { loginId: id, userId: 2222 });
  });

  test('tocar dos veces no duplica ni cambia nada', async () => {
    const { id, secret } = loginTelegram.crearSolicitud();
    await accion.h(ctxBoton(2222, `login_ok:${id}`));
    const ctx2 = ctxBoton(2222, `login_ok:${id}`);
    await accion.h(ctx2);
    expect(ctx2.editMessageText.mock.calls[0][0]).toMatch(/venció o ya se usó/);
    expect(loginTelegram.consultar(id, secret).userId).toBe('2222');
  });

  test('otra persona registrada no puede pisar una aprobación ya hecha', async () => {
    const { id, secret } = loginTelegram.crearSolicitud();
    await accion.h(ctxBoton(2222, `login_ok:${id}`));
    await accion.h(ctxBoton(1111, `login_ok:${id}`));
    expect(loginTelegram.consultar(id, secret)).toEqual({ estado: 'aprobada', userId: '2222' });
  });

  test('"No fui yo" rechaza, y después ya no se puede aprobar', async () => {
    const { id, secret } = loginTelegram.crearSolicitud();
    const ctx = ctxBoton(2222, `login_no:${id}`);
    await accion.h(ctx);
    expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/Pedido rechazado/);

    await accion.h(ctxBoton(2222, `login_ok:${id}`));
    expect(loginTelegram.consultar(id, secret)).toEqual({ estado: 'rechazada' });
  });

  test('alguien NO registrado que toca el botón no aprueba', async () => {
    const { id, secret } = loginTelegram.crearSolicitud();
    const ctx = ctxBoton(9999, `login_ok:${id}`);
    await accion.h(ctx);
    expect(loginTelegram.consultar(id, secret)).toEqual({ estado: 'pendiente' });
  });

  test('en un grupo no se puede aprobar', async () => {
    const { id, secret } = loginTelegram.crearSolicitud();
    await accion.h(ctxBoton(2222, `login_ok:${id}`, 'group'));
    expect(loginTelegram.consultar(id, secret)).toEqual({ estado: 'pendiente' });
  });

  test('una solicitud vencida no se aprueba', async () => {
    jest.useFakeTimers();
    const { id } = loginTelegram.crearSolicitud();
    jest.setSystemTime(Date.now() + loginTelegram.TTL_MS + 1000);
    const ctx = ctxBoton(2222, `login_ok:${id}`);
    await accion.h(ctx);
    expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/venció o ya se usó/);
    jest.useRealTimers();
  });
});

describe('texto de la confirmación', () => {
  test('escapa el Markdown de lo que viene del navegador (no se puede romper ni inyectar formato)', () => {
    const t = mensajeConfirmacion({ navegador: 'Chrome_*en* [x](http://evil)', ip: '1.2.3.4', creadaEn: Date.now() });
    expect(t).toContain('Chrome\\_\\*en\\* \\[x\\]\\(http://evil\\)');
  });

  test('IP ausente: "desconocida"', () => {
    expect(mensajeConfirmacion({ navegador: 'Chrome', ip: '', creadaEn: Date.now() })).toContain('IP desconocida');
  });

  test('haceCuanto', () => {
    const ahora = Date.now();
    expect(haceCuanto(ahora - 12000, ahora)).toBe('hace 12 s');
    expect(haceCuanto(ahora - 150000, ahora)).toBe('hace 3 min');
    expect(haceCuanto(ahora + 5000, ahora)).toBe('hace 0 s');
  });
});
