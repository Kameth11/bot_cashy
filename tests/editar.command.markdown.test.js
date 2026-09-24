// Ítem 3.4: bot.command('editar') hacía `ctx.reply(result.mensaje, ...)` SIN
// await, después de ya haber seteado pendingEdits — así que ni siquiera el
// try/catch del handler podía atrapar un rechazo de Telegram por Markdown
// roto, y el estado quedaba seteado igual.

jest.mock('../src/lib/telegraf', () => ({
  bot: { command: (name, handler) => { global.__editarHandlers[name] = handler; }, on: jest.fn(), use: jest.fn(), hears: jest.fn(), action: jest.fn(), catch: jest.fn() },
}));

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
}));

jest.mock('../src/services/cliente.service', () => ({
  get clientes() { return { '2222': { sheetId: 's', usuarios: [], permisos: {} } }; },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

jest.mock('../src/services/command.service', () => ({
  prepararEdicion: jest.fn().mockResolvedValue({
    state: { descripcion: 'Juan_Perez' },
    mensaje: '📝 *Editar movimiento*\n\n📝 Descripción actual: *Juan\\_Perez*',
  }),
}));

global.__editarHandlers = {};
const state = require('../src/state');
require('../src/handlers/commands/editar');

function ctxFor(userId) {
  return { from: { id: userId }, message: { text: '/editar Juan' }, reply: jest.fn().mockResolvedValue(true) };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.pendingEdits.delete(2222);
});

describe('/editar — el estado se setea recién después de que el envío salga bien', () => {
  test('camino feliz: pendingEdits queda seteado', async () => {
    const ctx = ctxFor(2222);
    await global.__editarHandlers.editar(ctx);
    expect(state.pendingEdits.has(2222)).toBe(true);
  });

  test('si el envío falla (Markdown roto), pendingEdits NO queda seteado', async () => {
    const ctx = ctxFor(2222);
    ctx.reply = jest.fn()
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities"))
      .mockResolvedValue(true);

    await global.__editarHandlers.editar(ctx);

    expect(state.pendingEdits.has(2222)).toBe(false);
    expect(ctx.reply).toHaveBeenLastCalledWith('❌ Error al buscar movimiento.');
  });
});
