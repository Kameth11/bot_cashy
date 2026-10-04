// Camino COMPLETO de un mensaje de texto: bot.on('text') -> parser real ->
// detección de ámbito real (marcarAmbito) -> handler real de nlp.js -> pantalla
// de confirmación. Solo se simulan los servicios externos y la confirmación,
// donde se captura lo que recibe el usuario.
//
// Existe porque el handler de registrar_movimiento descartaba el ámbito al armar
// la confirmación: todos los tests probaban cada pieza por separado y justo se
// mockeaba el tramo roto, así que todo salía "consultorio" sin que nada fallara.

global.__textHandlers = {};

jest.mock('../src/lib/telegraf', () => ({
  bot: { on: (e, h) => { global.__textHandlers[e] = h; }, command: jest.fn(), use: jest.fn(), hears: jest.fn(), action: jest.fn(), catch: jest.fn() },
}));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/config', () => ({
  METODOS_VALIDOS: ['efectivo', 'transferencia', 'tarjeta'],
  COMANDOS_INGRESO: ['consulta', 'servicio'],
  COMANDOS_EGRESO: ['gasto'],
  MAX_TEXT_LENGTH: 1000, MAX_DESCRIPCION_LENGTH: 120, MAX_MOVIMIENTO_MONTO: 1000000000, MAX_COTIZACION_DOLAR: 100000,
  AUTHORIZED_USER_ID: 1111, ALLOWED_EMAILS: [], CODIGO_EXPIRACION_HORAS: 24, DASHBOARD_URL: null,
}));
jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': {
        email: 'owner@test.com', sheetId: 'sheet-owner', usuarios: [3333],
        permisos: { '3333': ['ver_agenda', 'ver_movimientos', 'cargar_movimientos'] },
      },
    };
  },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));
jest.mock('../src/services/command.service', () => ({
  guardarMovimiento: jest.fn(), construirMensajeCotizacion: jest.fn(), ejecutarBalance: jest.fn(),
  ejecutarHoy: jest.fn(), ejecutarSemana: jest.fn(), ejecutarMes: jest.fn(), ejecutarIngresos: jest.fn(),
  ejecutarEgresos: jest.fn(), ejecutarPendientes: jest.fn(), ejecutarDolar: jest.fn(), ejecutarActualizarDolar: jest.fn(),
  ejecutarListar: jest.fn(), buscarCandidatosCobrar: jest.fn(), prepararEdicion: jest.fn(), prepararEliminacion: jest.fn(),
}));
// La pantalla de confirmación: acá se captura lo que le llega al usuario.
jest.mock('../src/handlers/nlp-confirm', () => ({
  mostrarConfirmacion: jest.fn().mockResolvedValue(undefined),
  actualizarCampoNlp: jest.fn(), crearMensajeConfirmacion: jest.fn(), discardButtons: jest.fn().mockReturnValue({}),
}));
jest.mock('../src/handlers/commands/salir', () => ({ procesarConfirmacionSalir: jest.fn() }));
jest.mock('../src/handlers/commands/sheet', () => ({ handleSheetCommand: jest.fn() }));
jest.mock('../src/handlers/actions', () => ({ confirmButtons: jest.fn().mockReturnValue({}) }));
jest.mock('../src/handlers/cobrar-confirm', () => ({ mostrarCobrar: jest.fn() }));
jest.mock('../src/services/gemini.service', () => ({ canAttemptRemoteNlp: jest.fn().mockReturnValue(false), parseMessage: jest.fn() }));
jest.mock('../src/services/openrouter.service', () => ({ canAttemptFullIA: jest.fn().mockReturnValue(false), parseMessage: jest.fn() }));
jest.mock('../src/services/registration.service', () => ({ handlePendingRegistration: jest.fn() }));
jest.mock('../src/services/personal.service', () => ({
  leerPreferencias: jest.fn().mockResolvedValue({}),
  obtenerViajeActivo: jest.fn().mockResolvedValue(null),
  correspondeAlViaje: jest.fn().mockReturnValue(false),
  fechaHoyStr: jest.fn().mockReturnValue('01/01/2026'),
}));
jest.mock('../src/services/casa.service', () => ({ listarMisCasas: jest.fn(), listarMiembros: jest.fn() }));

const state = require('../src/state');
const personalService = require('../src/services/personal.service');
const casaService = require('../src/services/casa.service');
const { mostrarConfirmacion } = require('../src/handlers/nlp-confirm');
require('../src/handlers/text'); // registra bot.on('text', ...)

const ctxFor = (userId, text) => ({ from: { id: userId }, message: { text }, reply: jest.fn().mockResolvedValue(true) });

// Escribe el mensaje como lo haría el usuario y devuelve lo que ve la confirmación.
async function escribir(userId, texto) {
  state.processingNlp.clear();
  const ctx = ctxFor(userId, texto);
  await global.__textHandlers.text(ctx);
  if (mostrarConfirmacion.mock.calls.length !== 1) {
    // Sin confirmación: mostrar qué le contestó el bot al usuario, que es lo que explica el fallo.
    throw new Error(`"${texto}" no llegó a la confirmación. Respuestas del bot: ${JSON.stringify(ctx.reply.mock.calls.map((c) => c[0]))}`);
  }
  return mostrarConfirmacion.mock.calls[0][1];
}

beforeEach(() => {
  jest.clearAllMocks();
  state.pendingNlpMovimientos.clear();
  personalService.leerPreferencias.mockResolvedValue({});
  casaService.listarMisCasas.mockReturnValue([]);
  casaService.listarMiembros.mockResolvedValue([]);
});

describe('un gasto por texto llega a la confirmación con el ámbito que se detectó', () => {
  test('"pague 15000 pesos para el cine" es PERSONAL / entretenimiento (el caso que fallaba)', async () => {
    const e = await escribir(2222, 'pague 15000 pesos para el cine');
    expect(e).toMatchObject({ tipo: 'gasto', monto: 15000, ambito: 'personal', categoria: 'entretenimiento', ambiguoAmbito: false });
    expect(e.textoOriginal).toBe('pague 15000 pesos para el cine');
  });

  test('el admin también', async () => {
    expect((await escribir(1111, 'pague 15000 pesos para el cine')).ambito).toBe('personal');
  });

  test('un gasto del consultorio sigue siendo consultorio', async () => {
    const e = await escribir(2222, 'pagué guantes y anestesia 30000');
    expect(e.ambito).toBe('consultorio');
    expect(e.ambiguoAmbito).toBe(false);
  });

  test('una empresa de servicios (Naturgy): categoría servicios, consultorio AMBIGUO para que el usuario confirme', async () => {
    const e = await escribir(2222, 'pagué naturgy 25000');
    expect(e).toMatchObject({ ambito: 'consultorio', ambiguoAmbito: true, terminoAmbito: 'naturgy', categoria: 'servicios' });
  });

  test('tras corregir una vez ("naturgy" -> personal), la próxima va directo a personal', async () => {
    personalService.leerPreferencias.mockResolvedValue({ naturgy: 'personal' });
    const e = await escribir(2222, 'pagué naturgy 25000');
    expect(e).toMatchObject({ ambito: 'personal', ambiguoAmbito: false, categoria: 'servicios' });
  });

  test('"luz de casa" es personal; "luz" sola es ambigua', async () => {
    expect((await escribir(2222, 'pagué la luz de casa 8000')).ambito).toBe('personal');
    mostrarConfirmacion.mockClear();
    expect(await escribir(2222, 'pagué la luz 8000')).toMatchObject({ ambito: 'consultorio', ambiguoAmbito: true, terminoAmbito: 'luz' });
  });

  test('un invitado sin ámbito personal: siempre consultorio', async () => {
    const e = await escribir(3333, 'pague 15000 pesos para el cine');
    expect(e.ambito).toBe('consultorio');
  });

  test('sin casas no aparecen campos de casa', async () => {
    const e = await escribir(2222, 'pague 15000 pesos para el cine');
    expect(e.casasDisponibles).toBeUndefined();
    expect(e.casaId).toBeUndefined();
  });
});

describe('un gasto de CASA por texto llega completo a la confirmación', () => {
  beforeEach(() => {
    casaService.listarMisCasas.mockReturnValue([{ casaId: 'casa_1', ownerId: '2222', nombre: 'Casa', activa: true }]);
    casaService.listarMiembros.mockResolvedValue([
      { id: 'm1', userId: '2222', nombre: 'Ana' },
      { id: 'm2', userId: '4444', nombre: 'Beto' },
    ]);
  });

  test('"pagué el super 45000 casa pagó Beto"', async () => {
    const e = await escribir(2222, 'pagué el super 45000 casa pagó Beto');
    expect(e).toMatchObject({
      ambito: 'casa', casaId: 'casa_1', casaNombre: 'Casa', monto: 45000,
      pagoPorId: 'm2', pagoPorNombre: 'Beto', repartoIds: null, categoria: 'supermercado',
    });
    expect(e.miembrosCasa).toEqual([{ id: 'm1', nombre: 'Ana' }, { id: 'm2', nombre: 'Beto' }]);
  });

  test('por defecto paga quien escribe', async () => {
    const e = await escribir(2222, 'pagué el super 45000 casa');
    expect(e).toMatchObject({ ambito: 'casa', pagoPorId: 'm1', pagoPorNombre: 'Ana' });
  });

  test('el selector de ámbito recibe las casas disponibles', async () => {
    const e = await escribir(2222, 'pague 15000 pesos para el cine');
    expect(e.ambito).toBe('personal');
    expect(e.casasDisponibles).toEqual([{ casaId: 'casa_1', nombre: 'Casa' }]);
  });

  test('un ingreso NUNCA va a la casa', async () => {
    const e = await escribir(2222, 'me entraron 15000 de la consulta casa');
    expect(e.ambito).not.toBe('casa');
  });
});

describe('los comandos con palabra clave ("gasto ...", "consulta ...") siguen siendo el camino rápido del consultorio', () => {
  // Diseño original: no pasan por el NLP ni por la pantalla de confirmación, así que no
  // detectan ámbito. Quien quiera personal o casa escribe en lenguaje natural.
  test('"gasto cine 15000" pide el método de pago y NO muestra la confirmación con ámbito', async () => {
    state.processingNlp.clear();
    const ctx = ctxFor(2222, 'gasto cine 15000');
    await global.__textHandlers.text(ctx);
    expect(mostrarConfirmacion).not.toHaveBeenCalled();
    expect(ctx.reply.mock.calls.map((c) => c[0]).join(' ')).toMatch(/Cómo pagaste/);
    state.pendingPayments.clear();
  });
});
