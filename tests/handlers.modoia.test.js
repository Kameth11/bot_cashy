const handlers = {};

jest.mock('../src/lib/telegraf', () => ({
  bot: {
    command: (name, handler) => { handlers[name] = handler; },
  },
}));

jest.mock('../src/auth', () => ({
  obtenerClientePorUserId: jest.fn(),
}));

jest.mock('../src/services/cliente.service', () => ({
  setModoFullIA: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/services/openrouter.service', () => ({
  canAttemptFullIA: jest.fn(),
}));

const { obtenerClientePorUserId } = require('../src/auth');
const clienteService = require('../src/services/cliente.service');
const { canAttemptFullIA } = require('../src/services/openrouter.service');

require('../src/handlers/commands/modoia');

function makeCtx(text, userId = 2222) {
  return {
    from: { id: userId },
    message: { text },
    reply: jest.fn().mockResolvedValue(true),
  };
}

describe('/modoia', () => {
  test('usuario sin cuenta registrada → avisa y no llama a setModoFullIA', async () => {
    obtenerClientePorUserId.mockReturnValue(null);
    const ctx = makeCtx('/modoia');

    await handlers.modoia(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No tenés una cuenta registrada'));
    expect(clienteService.setModoFullIA).not.toHaveBeenCalled();
  });

  test('sin OPENROUTER_API_KEY configurada → avisa que no está disponible', async () => {
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: false });
    canAttemptFullIA.mockReturnValue(false);
    const ctx = makeCtx('/modoia on');

    await handlers.modoia(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('no está disponible'));
    expect(clienteService.setModoFullIA).not.toHaveBeenCalled();
  });

  test('/modoia sin argumento muestra el estado actual sin cambiar nada', async () => {
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: true });
    canAttemptFullIA.mockReturnValue(true);
    const ctx = makeCtx('/modoia');

    await handlers.modoia(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('activado'), expect.any(Object));
    expect(clienteService.setModoFullIA).not.toHaveBeenCalled();
  });

  test('/modoia on activa el modo usando el ownerId del cliente (no el userId del que escribe)', async () => {
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: false });
    canAttemptFullIA.mockReturnValue(true);
    const ctx = makeCtx('/modoia on', 3333); // invitado, distinto del owner

    await handlers.modoia(ctx);

    expect(clienteService.setModoFullIA).toHaveBeenCalledWith('2222', true);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('activado'));
  });

  test('/modoia off desactiva el modo', async () => {
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: true });
    canAttemptFullIA.mockReturnValue(true);
    const ctx = makeCtx('/modoia off');

    await handlers.modoia(ctx);

    expect(clienteService.setModoFullIA).toHaveBeenCalledWith('2222', false);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('desactivado'));
  });

  test('argumento inválido → pide usar on/off sin tocar el estado', async () => {
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: false });
    canAttemptFullIA.mockReturnValue(true);
    const ctx = makeCtx('/modoia maybe');

    await handlers.modoia(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('on` o `/modoia off'), expect.any(Object));
    expect(clienteService.setModoFullIA).not.toHaveBeenCalled();
  });
});
