// Ítem 1.1: cargar un movimiento por texto libre (comando rápido tipo
// "consulta Juan $15000 efectivo" o lenguaje natural vía NLP) requiere
// cargar_movimientos. Consultas de solo lectura por NLP ("cuánto tengo
// hoy?") requieren el mismo permiso que su comando equivalente
// (ver_balance / ver_movimientos), no cargar_movimientos.

jest.mock('../src/lib/telegraf', () => ({
  bot: { on: (e, h) => { global.__nlpHandlers[e] = h; }, command: jest.fn(), use: jest.fn(), hears: jest.fn(), action: jest.fn(), catch: jest.fn() },
}));

jest.mock('../src/lib/logger', () => ({
  audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

jest.mock('../src/config', () => ({
  METODOS_VALIDOS: ['efectivo', 'transferencia', 'tarjeta'],
  COMANDOS_INGRESO: ['consulta', 'servicio'],
  COMANDOS_EGRESO: ['gasto'],
  MAX_TEXT_LENGTH: 1000,
  MAX_DESCRIPCION_LENGTH: 120,
  MAX_MOVIMIENTO_MONTO: 1000000000,
  MAX_COTIZACION_DOLAR: 100000,
  AUTHORIZED_USER_ID: 1111,
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  DASHBOARD_URL: null,
}));

jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': {
        email: 'owner@test.com',
        sheetId: 'sheet-owner',
        usuarios: [3333, 4444],
        permisos: {
          '3333': ['ver_agenda'], // sin cargar_movimientos ni ver_balance ni ver_movimientos
          '4444': ['ver_agenda', 'editar_agenda', 'ver_movimientos', 'cargar_movimientos', 'editar_movimientos', 'ver_balance'],
        },
      },
    };
  },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

jest.mock('../src/services/command.service', () => ({
  guardarMovimiento: jest.fn().mockResolvedValue({ mensaje: 'ok' }),
  construirMensajeCotizacion: jest.fn().mockResolvedValue('cotizacion'),
  ejecutarBalance: jest.fn().mockResolvedValue('balance'),
  ejecutarHoy: jest.fn().mockResolvedValue('hoy'),
  ejecutarSemana: jest.fn().mockResolvedValue('semana'),
  ejecutarMes: jest.fn().mockResolvedValue('mes'),
  ejecutarIngresos: jest.fn().mockResolvedValue('ingresos'),
  ejecutarEgresos: jest.fn().mockResolvedValue('egresos'),
  ejecutarPendientes: jest.fn().mockResolvedValue('pendientes'),
  ejecutarDolar: jest.fn().mockResolvedValue('dolar'),
  ejecutarActualizarDolar: jest.fn().mockResolvedValue('actualizado'),
  ejecutarListar: jest.fn().mockResolvedValue('listar'),
  buscarCandidatosCobrar: jest.fn().mockResolvedValue({ tipo: 'empty' }),
  prepararEdicion: jest.fn().mockResolvedValue('sin resultados'),
  prepararEliminacion: jest.fn().mockResolvedValue('sin resultados'),
}));

jest.mock('../src/handlers/commands/salir', () => ({ procesarConfirmacionSalir: jest.fn() }));
jest.mock('../src/handlers/nlp-confirm', () => ({
  actualizarCampoNlp: jest.fn(),
  crearMensajeConfirmacion: jest.fn(),
  discardButtons: jest.fn().mockReturnValue({}),
  mostrarConfirmacion: jest.fn(),
}));
jest.mock('../src/handlers/commands/sheet', () => ({ handleSheetCommand: jest.fn() }));
jest.mock('../src/handlers/actions', () => ({ confirmButtons: jest.fn().mockReturnValue({}) }));
jest.mock('../src/handlers/cobrar-confirm', () => ({ mostrarCobrar: jest.fn() }));

jest.mock('../src/services/gemini.service', () => ({
  canAttemptRemoteNlp: jest.fn().mockReturnValue(false),
  parseMessage: jest.fn(),
}));
jest.mock('../src/services/openrouter.service', () => ({
  canAttemptFullIA: jest.fn().mockReturnValue(false),
  parseMessage: jest.fn(),
}));
jest.mock('../src/services/quick_nlp.service', () => ({ quickParse: jest.fn().mockReturnValue(null) }));
jest.mock('../src/services/registration.service', () => ({ handlePendingRegistration: jest.fn() }));

global.__nlpHandlers = {};
const handlers = global.__nlpHandlers;

const cmd = require('../src/services/command.service');
const { mostrarCobrar } = require('../src/handlers/cobrar-confirm');
const { handleSheetCommand } = require('../src/handlers/commands/sheet');

require('../src/handlers/text'); // registra bot.on('text', ...)
const { handleNLPIntent } = require('../src/handlers/nlp');

function ctxFor(userId, text = '') {
  return { from: { id: userId }, message: { text }, reply: jest.fn().mockResolvedValue(true) };
}

const DENEGADO = expect.stringContaining('No tenés permiso');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Comando rápido por texto libre ("consulta Juan $15000 efectivo") requiere cargar_movimientos', () => {
  test('invitado solo-agenda (3333) → denegado, no se guarda el movimiento', async () => {
    const ctx = ctxFor(3333, 'consulta Juan Perez $15000 efectivo');
    await handlers.text(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
    expect(cmd.guardarMovimiento).not.toHaveBeenCalled();
  });

  test('invitado recepción (4444, tiene cargar_movimientos) → se guarda el movimiento', async () => {
    const ctx = ctxFor(4444, 'consulta Juan Perez $15000 efectivo');
    await handlers.text(ctx);
    expect(cmd.guardarMovimiento).toHaveBeenCalled();
  });
});

describe('handleNLPIntent — permiso por intent (lenguaje natural)', () => {
  const casosCargarMovimientos = ['registrar_movimiento', 'cobrar_movimiento'];
  test.each(casosCargarMovimientos)('intent "%s" requiere cargar_movimientos', async (intent) => {
    const denegado = ctxFor(3333);
    await handleNLPIntent(denegado, { intent, entities: { nombre: 'Juan' } });
    expect(denegado.reply).toHaveBeenCalledWith(DENEGADO);

    const permitido = ctxFor(4444);
    await handleNLPIntent(permitido, { intent, entities: { nombre: 'Juan' } });
    expect(permitido.reply).not.toHaveBeenCalledWith(DENEGADO);
  });

  const casosVerBalance = ['ver_balance', 'ver_semana', 'ver_mes'];
  test.each(casosVerBalance)('intent "%s" requiere ver_balance', async (intent) => {
    const ctx = ctxFor(3333);
    await handleNLPIntent(ctx, { intent, entities: {} });
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
  });

  const casosVerMovimientos = ['ver_hoy', 'ver_ingresos', 'ver_egresos', 'ver_pendientes', 'listar_movimientos'];
  test.each(casosVerMovimientos)('intent "%s" requiere ver_movimientos', async (intent) => {
    const ctx = ctxFor(3333);
    await handleNLPIntent(ctx, { intent, entities: {} });
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
  });

  test('intent "editar_movimiento" requiere editar_movimientos', async () => {
    const ctx = ctxFor(3333);
    await handleNLPIntent(ctx, { intent: 'editar_movimiento', entities: {} });
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
  });

  test('intent "eliminar_movimiento" requiere editar_movimientos', async () => {
    const ctx = ctxFor(3333);
    await handleNLPIntent(ctx, { intent: 'eliminar_movimiento', entities: {} });
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
  });

  test('invitado recepción (4444) tiene todos los permisos de arriba → ninguno es denegado', async () => {
    const intents = [...casosCargarMovimientos, ...casosVerBalance, ...casosVerMovimientos, 'editar_movimiento', 'eliminar_movimiento'];
    for (const intent of intents) {
      const ctx = ctxFor(4444);
      await handleNLPIntent(ctx, { intent, entities: { nombre: 'Juan' } });
      expect(ctx.reply).not.toHaveBeenCalledWith(DENEGADO);
    }
  });

  test('intents públicos/informativos (ver_dolar, ver_sheet) no requieren ningún permiso, ni para el invitado solo-agenda', async () => {
    const ctxDolar = ctxFor(3333);
    await handleNLPIntent(ctxDolar, { intent: 'ver_dolar', entities: {} });
    expect(ctxDolar.reply).not.toHaveBeenCalledWith(DENEGADO);
    expect(cmd.ejecutarDolar).toHaveBeenCalled();

    const ctxSheet = ctxFor(3333);
    await handleNLPIntent(ctxSheet, { intent: 'ver_sheet', entities: {} });
    expect(handleSheetCommand).toHaveBeenCalled();
  });
});
