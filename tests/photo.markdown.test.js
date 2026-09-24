// Ítem 3.4: los nombres leídos por Gemini Vision (cliente, servicio,
// profesional, consultorio) iban sin escapar en el mensaje de confirmación
// con parse_mode: 'Markdown'. Si traían "_" o "*", Telegram rechaza el
// mensaje entero — y como pendingAgendaConfirm se seteaba ANTES de mandarlo,
// el usuario quedaba trabado con "tenés un proceso pendiente" sin haber
// visto nunca los botones de confirmar/cancelar.

jest.mock('axios', () => ({ get: jest.fn().mockResolvedValue({ data: Buffer.from('fake') }) }));

jest.mock('../src/lib/telegraf', () => ({
  bot: { on: (e, h) => { global.__photoHandlers[e] = h; }, command: jest.fn(), use: jest.fn(), hears: jest.fn(), action: jest.fn(), catch: jest.fn() },
}));

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  MAX_PHOTO_SIZE_BYTES: 10 * 1024 * 1024,
  MAX_TURNOS_POR_IMAGEN: 120,
}));

jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return { '2222': { email: 'o@test.com', sheetId: 's', usuarios: [], permisos: {} } };
  },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

const TURNO_CON_CARACTERES_ESPECIALES = {
  hora: '10:00',
  cliente: 'Juan_Perez',
  servicio: 'Control *urgente*',
  profesional: null,
  consultorio: 'Consultorio 1',
};

jest.mock('../src/services/vision.service', () => ({
  procesarFotoAgenda: jest.fn().mockResolvedValue({ turnos: [TURNO_CON_CARACTERES_ESPECIALES] }),
}));

jest.mock('../src/services/agenda.service', () => ({
  resolverProfesional: jest.fn().mockReturnValue(null),
  obtenerConsultorioMap: jest.fn().mockResolvedValue({}),
}));

jest.mock('../src/services/tenant.service', () => ({
  resolveTenantId: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/handlers/actions', () => ({
  confirmButtons: jest.fn().mockReturnValue({ reply_markup: { inline_keyboard: [] } }),
}));

jest.mock('../src/handlers/guards', () => ({
  tieneProcesoPendiente: jest.fn().mockReturnValue(false),
}));

global.__photoHandlers = {};

const state = require('../src/state');
require('../src/handlers/photo');

function ctxFor(userId) {
  return {
    from: { id: userId },
    message: { photo: [{ file_id: 'f1', file_size: 1000 }] },
    telegram: { getFileLink: jest.fn().mockResolvedValue({ href: 'http://fake/file' }) },
    reply: jest.fn().mockResolvedValue(true),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.pendingAgendaConfirm.delete(2222);
  state.pendingAgendaConfirm.delete(3333);
});

describe('handler de foto — escapa Markdown en nombres leídos por el modelo', () => {
  test('el mensaje de confirmación escapa "_" y "*" del nombre/servicio', async () => {
    const ctx = ctxFor(2222);
    await global.__photoHandlers.photo(ctx);

    const [msg] = ctx.reply.mock.calls.find(call => typeof call[0] === 'string' && call[0].includes('Turnos encontrados'));
    expect(msg).toContain('Juan\\_Perez');
    expect(msg).toContain('Control \\*urgente\\*');
    // Nunca sin escapar.
    expect(msg).not.toContain('Juan_Perez');
    expect(msg).not.toContain('Control *urgente*');
  });

  test('camino feliz: pendingAgendaConfirm queda seteado después de mandar el mensaje', async () => {
    const ctx = ctxFor(2222);
    await global.__photoHandlers.photo(ctx);
    expect(state.pendingAgendaConfirm.has(2222)).toBe(true);
  });

  test('si el envío del mensaje de confirmación falla, pendingAgendaConfirm NO queda seteado (no se traba)', async () => {
    const ctx = ctxFor(2222);
    // Simula que Telegram rechaza el mensaje (ej. Markdown roto).
    ctx.reply = jest.fn()
      .mockResolvedValueOnce(true) // '📸 Procesando agenda...'
      .mockRejectedValueOnce(new Error('Bad Request: can\'t parse entities')) // la confirmación
      .mockResolvedValue(true); // el mensaje de error del catch

    await global.__photoHandlers.photo(ctx);

    expect(state.pendingAgendaConfirm.has(2222)).toBe(false);
    expect(ctx.reply).toHaveBeenLastCalledWith(expect.stringContaining('Error al procesar la imagen'));
  });

  // Ítem 3.6: el profesional se resuelve con el mapa consultorio->profesional
  // del TENANT (obtenerConsultorioMap), no con CONSULTORIO_MAP global.
  test('resuelve el profesional con el mapa del tenant, no con CONSULTORIO_MAP a secas', async () => {
    const { resolverProfesional, obtenerConsultorioMap } = require('../src/services/agenda.service');
    const { resolveTenantId } = require('../src/services/tenant.service');
    resolveTenantId.mockResolvedValue('tenant-xyz');
    const mapaDelTenant = { 'consultorio 1': 'Ana' };
    obtenerConsultorioMap.mockResolvedValue(mapaDelTenant);

    const ctx = ctxFor(2222);
    await global.__photoHandlers.photo(ctx);

    expect(resolveTenantId).toHaveBeenCalledWith(2222);
    expect(obtenerConsultorioMap).toHaveBeenCalledWith('tenant-xyz');
    expect(resolverProfesional).toHaveBeenCalledWith(null, 'Consultorio 1', mapaDelTenant);
  });
});
