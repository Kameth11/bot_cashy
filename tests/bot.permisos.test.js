// Ítem 1.1 de la revisión de seguridad: resolverPermisos solo se aplicaba en
// la API del dashboard, no en el bot de Telegram. Cualquier invitado (aunque
// solo tuviera ver_agenda) podía usar /balance, /eliminar, /debug, etc.
// Este archivo verifica que src/auth/bot-permisos.js (el mecanismo central)
// funciona, y que cada comando del bot exige el permiso correcto.

jest.mock('../src/lib/telegraf', () => ({
  bot: {
    command: (name, handler) => { global.__handlers[name] = handler; },
    on: (event, handler) => { global.__handlers[`on:${event}`] = handler; },
    use: jest.fn(), hears: jest.fn(), action: jest.fn(), catch: jest.fn(),
  },
}));

jest.mock('../src/lib/logger', () => ({
  audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

// Config mínima para que src/auth/index.js (real) resuelva permisos.
jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  DASHBOARD_URL: null,
}));

// Mismo fixture que tests/api.permisos.test.js: admin 1111, owner 2222,
// invitado 3333 (solo agenda), invitado 4444 (recepción, todos los permisos).
jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': {
        email: 'owner@test.com',
        sheetId: 'sheet-owner',
        usuarios: [3333, 4444],
        permisos: {
          '3333': ['ver_agenda', 'editar_agenda'],
          '4444': ['ver_agenda', 'editar_agenda', 'ver_movimientos', 'cargar_movimientos', 'editar_movimientos', 'ver_balance'],
        },
      },
    };
  },
  cargarClientes: jest.fn(),
  guardarClientes: jest.fn(),
  getCliente: jest.fn(),
  eliminarCliente: jest.fn(),
  getPermisos: jest.fn(),
  setPermisos: jest.fn(),
}));

jest.mock('../src/services/command.service', () => ({
  ejecutarBalance: jest.fn().mockResolvedValue('balance'),
  ejecutarMes: jest.fn().mockResolvedValue('mes'),
  ejecutarSemana: jest.fn().mockResolvedValue('semana'),
  ejecutarHoy: jest.fn().mockResolvedValue('hoy'),
  ejecutarIngresos: jest.fn().mockResolvedValue('ingresos'),
  ejecutarEgresos: jest.fn().mockResolvedValue('egresos'),
  ejecutarPendientes: jest.fn().mockResolvedValue('pendientes'),
  ejecutarDeudores: jest.fn().mockResolvedValue('deudores'),
  ejecutarCobrosPorMetodo: jest.fn().mockResolvedValue('cobros_por_metodo'),
  ejecutarEgresosCategoria: jest.fn().mockResolvedValue('egresos_categoria'),
  ejecutarPorProfesional: jest.fn().mockResolvedValue('por_profesional'),
  ejecutarListar: jest.fn().mockResolvedValue('listar'),
  prepararEdicion: jest.fn().mockResolvedValue('sin resultados'),
  buscarCandidatosCobrar: jest.fn().mockResolvedValue({ tipo: 'empty' }),
  guardarMovimiento: jest.fn().mockResolvedValue({ mensaje: 'ok' }),
}));

jest.mock('../src/handlers/cobrar-confirm', () => ({
  mostrarCobrar: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/handlers/actions', () => ({
  buildDeleteListKeyboard: jest.fn().mockReturnValue({ titulo: 'titulo', keyboard: {} }),
  confirmButtons: jest.fn().mockReturnValue({}),
}));

jest.mock('../src/services/db.service', () => ({
  getRows: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/services/sheet.service', () => ({
  getSheetId: jest.fn().mockReturnValue('sheet-id'),
  getSheetCliente: jest.fn().mockResolvedValue({ getRows: jest.fn().mockResolvedValue([]) }),
  obtenerDatosSheet: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/services/agenda.service', () => ({
  obtenerTurnosPorFecha: jest.fn().mockResolvedValue([{ hora: '10:00', cliente: 'Juan' }]),
  fechaHoyStr: jest.fn().mockReturnValue('2026-01-01'),
}));

global.__handlers = {};
const handlers = global.__handlers;

const logger = require('../src/lib/logger');
const cmd = require('../src/services/command.service');
const { mostrarCobrar } = require('../src/handlers/cobrar-confirm');
const dbService = require('../src/services/db.service');
const agendaService = require('../src/services/agenda.service');

// Requiere todos los comandos tocados por el ítem 1.1 — cada uno se
// registra en `handlers` bajo su nombre de comando.
require('../src/handlers/commands/balance');
require('../src/handlers/commands/mes');
require('../src/handlers/commands/semana');
require('../src/handlers/commands/hoy');
require('../src/handlers/commands/ingresos');
require('../src/handlers/commands/egresos');
require('../src/handlers/commands/pendientes');
require('../src/handlers/commands/deudores');
require('../src/handlers/commands/listar');
require('../src/handlers/commands/cobros_por_metodo');
require('../src/handlers/commands/egresos_categoria');
require('../src/handlers/commands/por_profesional');
require('../src/handlers/commands/eliminar');
require('../src/handlers/commands/editar');
require('../src/handlers/commands/cobrar');
require('../src/handlers/commands/pendiente');
require('../src/handlers/commands/ingreso_paciente');
require('../src/handlers/commands/editarturno');
require('../src/handlers/commands/limpiar');
require('../src/handlers/commands/regenerar_ids');
require('../src/handlers/commands/debug');

function ctxFor(userId, text = '') {
  return { from: { id: userId }, message: { text }, reply: jest.fn().mockResolvedValue(true) };
}

const DENEGADO = expect.stringContaining('No tenés permiso');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('src/auth/bot-permisos.js — mecanismo central', () => {
  const { tienePermisoBot, esDuenoBot, requierePermisoBot, requiereDuenoBot } = require('../src/auth/bot-permisos');

  test('tienePermisoBot: true solo si el permiso está en resolverPermisos', () => {
    expect(tienePermisoBot(4444, 'ver_balance')).toBe(true);
    expect(tienePermisoBot(3333, 'ver_balance')).toBe(false);
  });

  test('esDuenoBot: true para admin y owner, false para invitado', () => {
    expect(esDuenoBot(1111)).toBe(true);
    expect(esDuenoBot(2222)).toBe(true);
    expect(esDuenoBot(4444)).toBe(false);
  });

  test('requierePermisoBot deniega, responde y audita cuando falta el permiso', () => {
    const ctx = ctxFor(3333);
    const ok = requierePermisoBot(ctx, 'ver_balance', '/balance');

    expect(ok).toBe(false);
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
    expect(logger.audit).toHaveBeenCalledWith('permiso_denegado', expect.objectContaining({
      userId: 3333, permiso: 'ver_balance', comando: '/balance',
    }));
  });

  test('requierePermisoBot deja pasar y no responde ni audita cuando el permiso está', () => {
    const ctx = ctxFor(4444);
    const ok = requierePermisoBot(ctx, 'ver_balance', '/balance');

    expect(ok).toBe(true);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(logger.audit).not.toHaveBeenCalled();
  });

  test('requiereDuenoBot deniega a un invitado con todos los permisos granulares pero sin ser dueño', () => {
    const ctx = ctxFor(4444);
    expect(requiereDuenoBot(ctx, '/debug')).toBe(false);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('solo para el dueño'));
  });
});

describe('Reportes que requieren ver_balance (/balance, /mes, /semana, /cobros_por_metodo, /egresos_categoria, /por_profesional)', () => {
  const casos = [
    ['balance', () => cmd.ejecutarBalance],
    ['mes', () => cmd.ejecutarMes],
    ['semana', () => cmd.ejecutarSemana],
    ['cobros_por_metodo', () => cmd.ejecutarCobrosPorMetodo],
    ['egresos_categoria', () => cmd.ejecutarEgresosCategoria],
    ['por_profesional', () => cmd.ejecutarPorProfesional],
  ];

  test.each(casos)('/%s: invitado solo-agenda (3333) → denegado, no llama al servicio', async (comando, getFn) => {
    const ctx = ctxFor(3333);
    await handlers[comando](ctx);
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
    expect(getFn()).not.toHaveBeenCalled();
  });

  test.each(casos)('/%s: invitado recepción (4444, tiene ver_balance) → permitido', async (comando, getFn) => {
    const ctx = ctxFor(4444);
    await handlers[comando](ctx);
    expect(getFn()).toHaveBeenCalledWith(4444);
  });
});

describe('Reportes que requieren ver_movimientos (/hoy, /ingresos, /egresos, /pendientes, /deudores, /listar)', () => {
  const casos = [
    ['hoy', () => cmd.ejecutarHoy],
    ['ingresos', () => cmd.ejecutarIngresos],
    ['egresos', () => cmd.ejecutarEgresos],
    ['pendientes', () => cmd.ejecutarPendientes],
    ['deudores', () => cmd.ejecutarDeudores],
    ['listar', () => cmd.ejecutarListar],
  ];

  test.each(casos)('/%s: invitado solo-agenda (3333) → denegado', async (comando, getFn) => {
    const ctx = ctxFor(3333);
    await handlers[comando](ctx);
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
    expect(getFn()).not.toHaveBeenCalled();
  });

  test.each(casos)('/%s: invitado recepción (4444) → permitido', async (comando, getFn) => {
    const ctx = ctxFor(4444);
    await handlers[comando](ctx);
    expect(getFn()).toHaveBeenCalledWith(4444);
  });
});

describe('/eliminar y /editar requieren editar_movimientos', () => {
  test('invitado recepción sin editar_movimientos sería denegado (regresión: 3333 no lo tiene)', async () => {
    const ctx = ctxFor(3333, '/eliminar');
    await handlers.eliminar(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
    expect(dbService.getRows).not.toHaveBeenCalled();
  });

  test('invitado recepción (4444, tiene editar_movimientos) puede /eliminar', async () => {
    const ctx = ctxFor(4444, '/eliminar');
    await handlers.eliminar(ctx);
    expect(dbService.getRows).toHaveBeenCalledWith(4444);
  });

  test('invitado solo-agenda (3333) no puede /editar', async () => {
    const ctx = ctxFor(3333, '/editar');
    await handlers.editar(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
    expect(cmd.prepararEdicion).not.toHaveBeenCalled();
  });

  test('invitado recepción (4444) puede /editar', async () => {
    const ctx = ctxFor(4444, '/editar');
    await handlers.editar(ctx);
    expect(cmd.prepararEdicion).toHaveBeenCalled();
  });
});

describe('/cobrar, /pendiente, /ingreso_paciente requieren cargar_movimientos', () => {
  test('invitado solo-agenda (3333) no puede /cobrar', async () => {
    const ctx = ctxFor(3333, '/cobrar');
    await handlers.cobrar(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
    expect(cmd.buscarCandidatosCobrar).not.toHaveBeenCalled();
  });

  test('invitado recepción (4444) puede /cobrar', async () => {
    const ctx = ctxFor(4444, '/cobrar');
    await handlers.cobrar(ctx);
    expect(mostrarCobrar).toHaveBeenCalled();
  });

  test('invitado solo-agenda (3333) no puede /pendiente', async () => {
    const ctx = ctxFor(3333, '/pendiente Juan $1000');
    await handlers.pendiente(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
    expect(cmd.guardarMovimiento).not.toHaveBeenCalled();
  });

  test('invitado recepción (4444) puede /pendiente', async () => {
    const ctx = ctxFor(4444, '/pendiente Juan $1000');
    await handlers.pendiente(ctx);
    expect(cmd.guardarMovimiento).toHaveBeenCalled();
  });

  test('invitado solo-agenda (3333) no puede /ingreso_paciente', async () => {
    const state = require('../src/state');
    const ctx = ctxFor(3333, '/ingreso_paciente');
    await handlers.ingreso_paciente(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
    expect(state.pendingIngresoPacientes.has(3333)).toBe(false);
  });

  test('invitado recepción (4444) puede /ingreso_paciente', async () => {
    const state = require('../src/state');
    const ctx = ctxFor(4444, '/ingreso_paciente');
    await handlers.ingreso_paciente(ctx);
    expect(state.pendingIngresoPacientes.has(4444)).toBe(true);
    state.pendingIngresoPacientes.delete(4444);
  });
});

describe('/editarturno requiere editar_agenda', () => {
  test('usuario sin editar_agenda (9999, desconocido → DEFAULT_PERMISOS) → denegado', async () => {
    const ctx = ctxFor(9999, '/editarturno');
    await handlers.editarturno(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
    expect(agendaService.obtenerTurnosPorFecha).not.toHaveBeenCalled();
  });

  test('invitado solo-agenda (3333, tiene editar_agenda) → permitido', async () => {
    const ctx = ctxFor(3333, '/editarturno');
    await handlers.editarturno(ctx);
    expect(agendaService.obtenerTurnosPorFecha).toHaveBeenCalledWith(3333, '2026-01-01');
  });
});

describe('/limpiar, /regenerar_ids, /debug son solo para el dueño o admin', () => {
  const sheetService = require('../src/services/sheet.service');
  const casos = ['limpiar', 'regenerar_ids', 'debug'];

  test.each(casos)('%s: invitado recepción (4444) con todos los permisos granulares → denegado igual', async (comando) => {
    const ctx = ctxFor(4444, `/${comando}`);
    await handlers[comando](ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('solo para el dueño'));
    expect(sheetService.getSheetId).not.toHaveBeenCalled();
    expect(sheetService.getSheetCliente).not.toHaveBeenCalled();
  });

  test.each(casos)('%s: owner (2222) → permitido', async (comando) => {
    const ctx = ctxFor(2222, `/${comando}`);
    await handlers[comando](ctx);
    expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringContaining('solo para el dueño'));
  });

  test.each(casos)('%s: admin (1111) → permitido', async (comando) => {
    const ctx = ctxFor(1111, `/${comando}`);
    await handlers[comando](ctx);
    expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringContaining('solo para el dueño'));
  });
});
