const handlers = {};

jest.mock('../src/lib/telegraf', () => ({
  bot: {
    command: (name, handler) => { handlers[name] = handler; },
  },
}));

jest.mock('../src/lib/logger', () => ({
  audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

jest.mock('../src/auth', () => ({
  obtenerClientePorUserId: jest.fn(),
  esAdminOriginal: jest.fn(() => false),
}));

jest.mock('../src/services/cliente.service', () => ({
  setModoFullIA: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/services/openrouter.service', () => ({
  canAttemptFullIA: jest.fn(),
}));

const { obtenerClientePorUserId, esAdminOriginal } = require('../src/auth');
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

const DENEGADO = expect.stringContaining('solo para el dueño');

beforeEach(() => {
  esAdminOriginal.mockReturnValue(false);
});

describe('/modoia', () => {
  test('usuario sin cuenta registrada → avisa y no llama a setModoFullIA', async () => {
    obtenerClientePorUserId.mockReturnValue(null);
    const ctx = makeCtx('/modoia');

    await handlers.modoia(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No tenés una cuenta registrada'));
    expect(clienteService.setModoFullIA).not.toHaveBeenCalled();
  });

  test('sin OPENROUTER_API_KEY configurada → avisa que no está disponible', async () => {
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: false, isOwner: true });
    canAttemptFullIA.mockReturnValue(false);
    const ctx = makeCtx('/modoia on');

    await handlers.modoia(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('no está disponible'));
    expect(clienteService.setModoFullIA).not.toHaveBeenCalled();
  });

  test('/modoia sin argumento muestra el estado actual sin cambiar nada (cualquier miembro, no solo el dueño)', async () => {
    // Invitado (no owner, no admin) — ver el estado no está restringido, solo activar/desactivar.
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: true, isOwner: false });
    canAttemptFullIA.mockReturnValue(true);
    const ctx = makeCtx('/modoia', 3333);

    await handlers.modoia(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('activado'), expect.any(Object));
    expect(clienteService.setModoFullIA).not.toHaveBeenCalled();
  });

  test('invitado (no owner, no admin) NO puede activar/desactivar — genera costo en OpenRouter', async () => {
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: false, isOwner: false });
    canAttemptFullIA.mockReturnValue(true);
    const ctx = makeCtx('/modoia on', 3333); // invitado, distinto del owner

    await handlers.modoia(ctx);

    expect(clienteService.setModoFullIA).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
  });

  test('/modoia on activa el modo usando el ownerId del cliente (no el userId del admin que escribe)', async () => {
    esAdminOriginal.mockReturnValue(true); // quien escribe es el admin original, no el owner de esta cuenta
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: false, isOwner: false });
    canAttemptFullIA.mockReturnValue(true);
    const ctx = makeCtx('/modoia on', 1111);

    await handlers.modoia(ctx);

    expect(clienteService.setModoFullIA).toHaveBeenCalledWith('2222', true);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('activado'));
  });

  test('/modoia off desactiva el modo cuando lo pide el dueño de la cuenta', async () => {
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: true, isOwner: true });
    canAttemptFullIA.mockReturnValue(true);
    const ctx = makeCtx('/modoia off');

    await handlers.modoia(ctx);

    expect(clienteService.setModoFullIA).toHaveBeenCalledWith('2222', false);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('desactivado'));
  });

  test('argumento inválido → pide usar on/off sin tocar el estado', async () => {
    obtenerClientePorUserId.mockReturnValue({ ownerId: '2222', modoFullIA: false, isOwner: true });
    canAttemptFullIA.mockReturnValue(true);
    const ctx = makeCtx('/modoia maybe');

    await handlers.modoia(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('on` o `/modoia off'), expect.any(Object));
    expect(clienteService.setModoFullIA).not.toHaveBeenCalled();
  });
});
