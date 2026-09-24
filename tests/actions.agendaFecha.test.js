// Ítem 3.5: después de confirmar los turnos leídos de una foto, el bot los
// guardaba siempre para "hoy" y sin chequear si ya existían (reenviar la
// misma foto duplicaba todo). Ahora se pregunta la fecha (Hoy/Mañana/Otra
// fecha) y, si hay turnos que ya existen para esa fecha (misma hora +
// paciente normalizado), se pregunta si reemplazarlos o agregar todo.

jest.mock('../src/lib/telegraf', () => ({
  bot: { action: (pattern, handler) => { global.__actionHandlers[pattern] = handler; }, on: jest.fn(), command: jest.fn(), use: jest.fn(), hears: jest.fn(), catch: jest.fn() },
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
jest.mock('../src/services/sheet-format.service', () => ({ aplicarColorMontoEnFila: jest.fn() }));
jest.mock('../src/lib/write-queue', () => ({ withUserWriteLock: jest.fn((_, fn) => fn()) }));

const mockDetectarDuplicados = jest.fn();
const mockGuardarAgendaParaFecha = jest.fn();
jest.mock('../src/services/agenda.service', () => ({
  detectarDuplicados: (...args) => mockDetectarDuplicados(...args),
  guardarAgendaParaFecha: (...args) => mockGuardarAgendaParaFecha(...args),
}));

global.__actionHandlers = {};
const state = require('../src/state');
require('../src/handlers/actions');

function ctxFor(userId) {
  return {
    from: { id: userId },
    answerCbQuery: jest.fn().mockResolvedValue(true),
    editMessageText: jest.fn().mockResolvedValue(true),
    reply: jest.fn().mockResolvedValue(true),
  };
}

const TURNOS = [{ hora: '10:00', cliente: 'Juan' }];

beforeEach(() => {
  jest.clearAllMocks();
  state.pendingAgendaConfirm.delete(1111);
  state.pendingAgendaFecha.delete(1111);
  state.pendingAgendaDuplicados.delete(1111);
});

test('confirm_agenda pasa al selector de fecha en vez de guardar directo', async () => {
  state.pendingAgendaConfirm.set(1111, { turnos: TURNOS });
  const ctx = ctxFor(1111);

  await global.__actionHandlers['confirm_agenda'](ctx);

  expect(mockGuardarAgendaParaFecha).not.toHaveBeenCalled();
  expect(state.pendingAgendaConfirm.has(1111)).toBe(false);
  expect(state.pendingAgendaFecha.has(1111)).toBe(true);
  expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining('qué día'), expect.anything());
});

test('agenda_fecha_hoy guarda directo cuando no hay duplicados', async () => {
  state.pendingAgendaFecha.set(1111, { turnos: TURNOS });
  mockDetectarDuplicados.mockResolvedValue([]);
  mockGuardarAgendaParaFecha.mockResolvedValue({ guardados: 1, total: 1, fechaStr: '24/09/2026' });
  const ctx = ctxFor(1111);

  await global.__actionHandlers['agenda_fecha_hoy'](ctx);

  expect(mockGuardarAgendaParaFecha).toHaveBeenCalledWith(1111, TURNOS, expect.any(String));
  expect(state.pendingAgendaDuplicados.has(1111)).toBe(false);
  expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('guardado'), expect.anything());
});

test('agenda_fecha_hoy pregunta reemplazar/agregar cuando hay duplicados, sin guardar todavía', async () => {
  state.pendingAgendaFecha.set(1111, { turnos: TURNOS });
  mockDetectarDuplicados.mockResolvedValue([{ nuevoIndex: 0, existente: { idTurno: 'viejo1', cliente: 'Juan', hora: '10:00' } }]);
  const ctx = ctxFor(1111);

  await global.__actionHandlers['agenda_fecha_hoy'](ctx);

  expect(mockGuardarAgendaParaFecha).not.toHaveBeenCalled();
  expect(state.pendingAgendaDuplicados.has(1111)).toBe(true);
  expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('ya existe'), expect.anything());
});

test('agenda_dup_reemplazar borra los duplicados detectados y guarda el resto', async () => {
  state.pendingAgendaDuplicados.set(1111, {
    turnos: TURNOS,
    fecha: '24/09/2026',
    duplicados: [{ nuevoIndex: 0, existente: { idTurno: 'viejo1' } }],
  });
  mockGuardarAgendaParaFecha.mockResolvedValue({ guardados: 1, total: 1, fechaStr: '24/09/2026' });
  const ctx = ctxFor(1111);

  await global.__actionHandlers['agenda_dup_reemplazar'](ctx);

  expect(mockGuardarAgendaParaFecha).toHaveBeenCalledWith(1111, TURNOS, '24/09/2026', { idsAEliminar: ['viejo1'] });
  expect(state.pendingAgendaDuplicados.has(1111)).toBe(false);
});

test('agenda_dup_agregar guarda todo sin borrar nada', async () => {
  state.pendingAgendaDuplicados.set(1111, {
    turnos: TURNOS,
    fecha: '24/09/2026',
    duplicados: [{ nuevoIndex: 0, existente: { idTurno: 'viejo1' } }],
  });
  mockGuardarAgendaParaFecha.mockResolvedValue({ guardados: 1, total: 1, fechaStr: '24/09/2026' });
  const ctx = ctxFor(1111);

  await global.__actionHandlers['agenda_dup_agregar'](ctx);

  expect(mockGuardarAgendaParaFecha).toHaveBeenCalledWith(1111, TURNOS, '24/09/2026');
  expect(state.pendingAgendaDuplicados.has(1111)).toBe(false);
});

test('cancel_agenda limpia los 3 estados de agenda pendientes', async () => {
  state.pendingAgendaConfirm.set(1111, {});
  state.pendingAgendaFecha.set(1111, {});
  state.pendingAgendaDuplicados.set(1111, {});
  const ctx = ctxFor(1111);

  await global.__actionHandlers['cancel_agenda'](ctx);

  expect(state.pendingAgendaConfirm.has(1111)).toBe(false);
  expect(state.pendingAgendaFecha.has(1111)).toBe(false);
  expect(state.pendingAgendaDuplicados.has(1111)).toBe(false);
});
