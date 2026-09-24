// Ítem 3.4: el nombre del paciente leído por OCR (turno.cliente) iba sin
// escapar en el mensaje "¿Qué campo querés editar?" (parse_mode: Markdown).
// pendingTurnoEdits.step se seteaba a 'select_campo' ANTES de mandar ese
// mensaje, así que un nombre con "_"/"*" dejaba al usuario trabado.

jest.mock('../src/lib/telegraf', () => ({
  bot: { action: (pattern, handler) => { global.__actionHandlers.push({ pattern, handler }); }, on: jest.fn(), command: jest.fn(), use: jest.fn(), hears: jest.fn(), catch: jest.fn() },
}));
jest.mock('telegraf', () => ({
  Markup: {
    inlineKeyboard: jest.fn((rows) => ({ reply_markup: { inline_keyboard: rows } })),
    button: { callback: jest.fn((label, id) => ({ text: label, callback_data: id })) },
  },
}));

jest.mock('../src/lib/google', () => ({ GoogleSpreadsheet: jest.fn(), serviceAccountAuth: {} }));
jest.mock('../src/auth', () => ({ esAdminOriginal: jest.fn(() => false), obtenerClientePorUserId: jest.fn(() => null) }));
jest.mock('../src/services/cliente.service', () => ({ clientes: {} }));
jest.mock('../src/services/sheet.service', () => ({ invalidateCache: jest.fn() }));
jest.mock('../src/services/movimiento.service', () => ({ convertirAPesos: jest.fn() }));
jest.mock('../src/services/cotizacion.service', () => ({ obtenerCotizacionDolar: jest.fn() }));
jest.mock('../src/services/agenda.service', () => ({ guardarTurnosAgenda: jest.fn(), guardarTurnosFlat: jest.fn() }));
jest.mock('../src/services/sheet-format.service', () => ({ aplicarColorMontoEnFila: jest.fn() }));
jest.mock('../src/lib/write-queue', () => ({ withUserWriteLock: jest.fn((_, fn) => fn()) }));

global.__actionHandlers = [];

const state = require('../src/state');
require('../src/handlers/actions');

function findHandler(name) {
  const found = global.__actionHandlers.find(a => a.pattern === name || (a.pattern instanceof RegExp && a.pattern.test(name)));
  return found && found.handler;
}

function ctxFor(userId, matchInput) {
  const pattern = /^agenda_edit_pick_(\d+)$/;
  return {
    from: { id: userId },
    match: pattern.exec(matchInput),
    answerCbQuery: jest.fn().mockResolvedValue(true),
    editMessageText: jest.fn().mockResolvedValue(true),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.pendingTurnoEdits.clear();
});

describe('agenda_edit_pick — escapa Markdown y setea el estado solo si el envío sale bien', () => {
  test('escapa "_" del nombre del paciente en el mensaje', async () => {
    const handler = findHandler('agenda_edit_pick_0');
    state.pendingTurnoEdits.set(5000, { turnos: [{ hora: '10:00', cliente: 'Juan_Perez' }] });

    const ctx = ctxFor(5000, 'agenda_edit_pick_0');
    await handler(ctx);

    const [msg] = ctx.editMessageText.mock.calls[0];
    expect(msg).toContain('Juan\\_Perez');
    expect(msg).not.toContain('Juan_Perez');
  });

  test('camino feliz: pendingTurnoEdits.step queda en select_campo después del envío', async () => {
    const handler = findHandler('agenda_edit_pick_0');
    state.pendingTurnoEdits.set(5000, { turnos: [{ hora: '10:00', cliente: 'Juan Perez' }] });

    await handler(ctxFor(5000, 'agenda_edit_pick_0'));

    expect(state.pendingTurnoEdits.get(5000).step).toBe('select_campo');
  });

  test('si editMessageText falla, el estado NO avanza a select_campo (no se traba)', async () => {
    const handler = findHandler('agenda_edit_pick_0');
    state.pendingTurnoEdits.set(5000, { turnos: [{ hora: '10:00', cliente: 'Juan_Perez' }] });

    const ctx = ctxFor(5000, 'agenda_edit_pick_0');
    ctx.editMessageText = jest.fn()
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities"))
      .mockResolvedValue(true);

    await handler(ctx);

    expect(state.pendingTurnoEdits.get(5000).step).not.toBe('select_campo');
    expect(ctx.editMessageText).toHaveBeenLastCalledWith(expect.stringContaining('Error al mostrar el turno'));
  });
});
