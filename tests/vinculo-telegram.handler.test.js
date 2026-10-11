// Bot: /start vincular_<token>, los botones ✅/❌ y el middleware que reconoce al Telegram vinculado.
// Piezas reales: cliente.service, vinculo-telegram.service, auth y state. Solo se simulan Telegraf,
// la config, el sistema de archivos, el logger y el alta de usuarios.

const mockCmds = {};
const mockActions = [];
const mockMiddlewares = [];

jest.mock('fs', () => ({ existsSync: jest.fn(() => false), readFileSync: jest.fn(), writeFileSync: jest.fn() }));
jest.mock('../src/lib/telegraf', () => ({
  bot: {
    command: (name, h) => { mockCmds[name] = h; },
    action: (re, h) => { mockActions.push({ re, h }); },
    use: (fn) => { mockMiddlewares.push(fn); },
  },
}));
jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111, ALLOWED_EMAILS: [], CODIGO_EXPIRACION_HORAS: 24, MAX_INTENTOS_CODIGO: 5,
  USE_SUPABASE: false, CLIENTES_FILE: '/tmp/clientes_vinculo_telegram_test.json',
  RATE_LIMIT_WINDOW_MS: 10000, RATE_LIMIT_MAX_EVENTS: 1000, MAX_TEXT_LENGTH: 1000,
}));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/services/registration.service', () => ({ handleStart: jest.fn(async () => ({ message: 'BIENVENIDA' })) }));

const clienteService = require('../src/services/cliente.service');
const vinculo = require('../src/services/vinculo-telegram.service');
require('../src/handlers/middleware');
require('../src/handlers/commands/start');
require('../src/handlers/vinculo-telegram');

const accion = mockActions.find((a) => String(a.re).includes('vinculo_'));

const DUENO = 2222;
const WEB = -1790000000000123;
const WEB2 = -1790000000000456;
const TG_LIBRE = 555000111;
const TG_OTRO = 555000222;

function ctxStart(userId, texto, chatType = 'private', state) {
  return { from: { id: userId }, chat: { type: chatType }, message: { text: texto }, state, reply: jest.fn().mockResolvedValue(true) };
}
function ctxBoton(userId, data, chatType = 'private', state) {
  return {
    from: { id: userId }, chat: { type: chatType }, match: accion.re.exec(data), state,
    callbackQuery: { data },
    answerCbQuery: jest.fn().mockResolvedValue(true), editMessageText: jest.fn().mockResolvedValue(true),
  };
}
const botones = (ctx) => ctx.reply.mock.calls[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
const textoFinal = (ctx) => String(ctx.editMessageText.mock.calls[0][0]);

beforeEach(() => {
  jest.clearAllMocks();
  vinculo._reiniciar();
  clienteService.clientes = {
    [DUENO]: { email: 'owner@clinica.com', sheetId: 'S1', usuarios: [WEB, WEB2], permisos: { [WEB]: ['ver_agenda'], [WEB2]: ['ver_agenda'] } },
    [WEB]: { email: 'ana@gmail.com', sheetId: 'S1', usuarios: [], permisos: {}, googleSub: 'sub-ana' },
    [WEB2]: { email: 'beto@gmail.com', sheetId: 'S1', usuarios: [], permisos: {}, googleSub: 'sub-beto' },
  };
});

describe('/start vincular_<token>: confirmación', () => {
  test('muestra QUÉ cuenta se va a vincular y pide confirmar (nunca inicia un alta)', async () => {
    const { token } = vinculo.crearPedido(WEB);
    const ctx = ctxStart(TG_LIBRE, `/start vincular_${token}`);
    await mockCmds.start(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain('ana@gmail.com');
    expect(ctx.reply.mock.calls[0][0]).toMatch(/solo si pediste esto vos/i);
    expect(botones(ctx)).toEqual([`vinculo_ok:${token}`, `vinculo_no:${token}`]);
    expect(require('../src/services/registration.service').handleStart).not.toHaveBeenCalled();
    expect(clienteService.cuentaPorTelegramId(TG_LIBRE)).toBeNull(); // todavía no vinculó nada
  });

  test('un token inventado o vencido no muestra nada de la cuenta', async () => {
    const ctx = ctxStart(TG_LIBRE, '/start vincular_ABCDEFGHIJKLMNOP');
    await mockCmds.start(ctx);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/venció|ya se usó/);
    expect(ctx.reply.mock.calls[0][1]).not.toHaveProperty('reply_markup');
  });

  test('solo en chat privado', async () => {
    const { token } = vinculo.crearPedido(WEB);
    const ctx = ctxStart(TG_LIBRE, `/start vincular_${token}`, 'group');
    await mockCmds.start(ctx);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/privada/);
    expect(ctx.reply.mock.calls[0][1]).toBeUndefined();
  });

  test.each([
    ['el dueño (tiene su propia cuenta)', DUENO, /propia cuenta/],
    ['el admin original', 1111, /propia cuenta/],
  ])('%s no puede vincularse a otra cuenta', async (_n, telegramId, esperado) => {
    const { token } = vinculo.crearPedido(WEB);
    const ctx = ctxStart(telegramId, `/start vincular_${token}`);
    await mockCmds.start(ctx);
    expect(String(ctx.reply.mock.calls[0][0])).toMatch(esperado);
    expect(ctx.reply.mock.calls[0][1]).toBeUndefined(); // sin botones
  });

  test('un Telegram ya vinculado a OTRA cuenta no puede; a la misma, se le avisa que ya está', async () => {
    await clienteService.vincularTelegram(WEB2, TG_OTRO);
    const { token } = vinculo.crearPedido(WEB);

    // Telegram de Beto (ya vinculado a WEB2): el middleware lo trae como WEB2 y deja el real en state.
    const ctxOtra = ctxStart(WEB2, `/start vincular_${token}`, 'private', { telegramId: TG_OTRO });
    await mockCmds.start(ctxOtra);
    expect(String(ctxOtra.reply.mock.calls[0][0])).toMatch(/ya está vinculado a otra cuenta/);

    const { token: t2 } = vinculo.crearPedido(WEB2);
    const ctxMisma = ctxStart(WEB2, `/start vincular_${t2}`, 'private', { telegramId: TG_OTRO });
    await mockCmds.start(ctxMisma);
    expect(String(ctxMisma.reply.mock.calls[0][0])).toMatch(/ya está vinculado a esa cuenta/);
  });
});

describe('botones ✅ / ❌', () => {
  test('✅ vincula el Telegram de QUIEN TOCA a la cuenta del pedido, y el token no se reusa', async () => {
    const { token } = vinculo.crearPedido(WEB);
    const ctx = ctxBoton(TG_LIBRE, `vinculo_ok:${token}`);
    await accion.h(ctx);
    expect(textoFinal(ctx)).toMatch(/quedó vinculado/);
    expect(clienteService.clientes[String(WEB)].telegramId).toBe(TG_LIBRE);
    expect(clienteService.cuentaPorTelegramId(TG_LIBRE)).toBe(String(WEB));

    // segundo toque: ya se usó
    const ctx2 = ctxBoton(TG_OTRO, `vinculo_ok:${token}`);
    await accion.h(ctx2);
    expect(textoFinal(ctx2)).toMatch(/venció|ya se usó/);
    expect(clienteService.cuentaPorTelegramId(TG_OTRO)).toBeNull();
  });

  test('la identidad vinculada es la del Telegram real (state), no la de la cuenta', async () => {
    // Caso borde: un Telegram ya reemplazado por el middleware no puede vincular a otra cuenta.
    await clienteService.vincularTelegram(WEB2, TG_OTRO);
    const { token } = vinculo.crearPedido(WEB);
    const ctx = ctxBoton(WEB2, `vinculo_ok:${token}`, 'private', { telegramId: TG_OTRO });
    await accion.h(ctx);
    expect(textoFinal(ctx)).toMatch(/ya está vinculado a otra cuenta/);
    expect(clienteService.clientes[String(WEB)].telegramId).toBeUndefined();
  });

  test('❌ no vincula nada y consume el pedido', async () => {
    const { token } = vinculo.crearPedido(WEB);
    const ctx = ctxBoton(TG_LIBRE, `vinculo_no:${token}`);
    await accion.h(ctx);
    expect(textoFinal(ctx)).toMatch(/rechazado/);
    expect(clienteService.cuentaPorTelegramId(TG_LIBRE)).toBeNull();
    expect(vinculo.obtenerPedido(token)).toBeNull();
  });

  test('si el Telegram ya tiene cuenta propia, ✅ no vincula', async () => {
    const { token } = vinculo.crearPedido(WEB);
    const ctx = ctxBoton(DUENO, `vinculo_ok:${token}`);
    await accion.h(ctx);
    expect(textoFinal(ctx)).toMatch(/propia cuenta/);
    expect(clienteService.clientes[String(WEB)].telegramId).toBeUndefined();
  });

  test('solo se confirma en chat privado', async () => {
    const { token } = vinculo.crearPedido(WEB);
    const ctx = ctxBoton(TG_LIBRE, `vinculo_ok:${token}`, 'group');
    await accion.h(ctx);
    expect(textoFinal(ctx)).toMatch(/privada/);
    expect(clienteService.cuentaPorTelegramId(TG_LIBRE)).toBeNull();
  });
});

describe('middleware: el Telegram vinculado ES la cuenta para todo el bot', () => {
  // Corre TODOS los middlewares registrados, en orden, como Telegraf. -> true si el bot atendió al usuario.
  async function atender(ctx) {
    let i = 0;
    let llego = false;
    const siguiente = async () => {
      const mw = mockMiddlewares[i++];
      if (!mw) { llego = true; return; }
      await mw(ctx, siguiente);
    };
    await siguiente();
    return llego;
  }

  test('reemplaza ctx.from.id por el de la cuenta y deja el Telegram real en ctx.state', async () => {
    await clienteService.vincularTelegram(WEB, TG_LIBRE);
    const ctx = { from: { id: TG_LIBRE }, chat: { type: 'private' }, message: { text: 'hola' }, reply: jest.fn().mockResolvedValue(true) };
    expect(await atender(ctx)).toBe(true);
    expect(ctx.from.id).toBe(WEB);
    expect(ctx.state.telegramId).toBe(TG_LIBRE);
  });

  test('un Telegram vinculado está autorizado (como invitado del dueño); uno sin cuenta, no', async () => {
    await clienteService.vincularTelegram(WEB, TG_LIBRE);
    const vinculado = { from: { id: TG_LIBRE }, chat: { type: 'private' }, message: { text: '/hoy' }, reply: jest.fn().mockResolvedValue(true) };
    expect(await atender(vinculado)).toBe(true);
    expect(vinculado.reply).not.toHaveBeenCalled();

    const desconocido = { from: { id: TG_OTRO }, chat: { type: 'private' }, message: { text: '/hoy' }, reply: jest.fn().mockResolvedValue(true) };
    expect(await atender(desconocido)).toBe(false);
    expect(desconocido.reply).toHaveBeenCalledWith(expect.stringMatching(/No estas autorizado/));
    expect(desconocido.from.id).toBe(TG_OTRO); // sin cambios
  });

  test('el botón de confirmar el vínculo lo puede tocar alguien SIN cuenta (y solo ese botón)', async () => {
    const boton = (data) => ({
      from: { id: TG_OTRO }, chat: { type: 'private' }, callbackQuery: { data }, reply: jest.fn().mockResolvedValue(true),
    });
    expect(await atender(boton('vinculo_ok:ABCDEFGHIJKLMNOP'))).toBe(true);
    expect(await atender(boton('login_ok:ABCDEFGHIJKLMNOPQRSTUV'))).toBe(false);
    expect(await atender(boton('cualquier_otra_accion'))).toBe(false);
  });

  test('tras desvincular, el Telegram vuelve a ser un desconocido', async () => {
    await clienteService.vincularTelegram(WEB, TG_LIBRE);
    await clienteService.desvincularTelegram(WEB);
    const ctx = { from: { id: TG_LIBRE }, chat: { type: 'private' }, message: { text: '/hoy' }, reply: jest.fn().mockResolvedValue(true) };
    expect(await atender(ctx)).toBe(false);
    expect(ctx.from.id).toBe(TG_LIBRE);
  });
});
