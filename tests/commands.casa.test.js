const mockHandlers = {};
let mockContador = 0;

jest.mock('../src/lib/telegraf', () => ({
  bot: {
    command: (name, h) => { mockHandlers[name] = h; },
    telegram: { sendMessage: jest.fn().mockResolvedValue(true) },
  },
}));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/auth', () => ({
  obtenerClientePorUserId: jest.fn(() => ({ isOwner: true })),
  getIntentosCodigo: jest.fn(() => 0),
  incrementIntentosCodigo: jest.fn(),
  resetIntentosCodigo: jest.fn(),
}));
jest.mock('../src/services/invite.service', () => ({
  generateInviteCode: jest.fn(() => `COD${++mockContador}`),
  beginInviteRegistration: jest.fn(async () => ({ message: 'flujo consultorio' })),
}));
jest.mock('../src/services/casa.service', () => {
  class CasaError extends Error { constructor(code) { super(code); this.code = code; } }
  return {
    CasaError,
    listarMisCasas: jest.fn(),
    getCasaActiva: jest.fn(),
    setCasaActiva: jest.fn(),
    crearCasa: jest.fn(),
    listarMiembros: jest.fn(),
    agregarMiembroVirtual: jest.fn(),
    unirMiembro: jest.fn(),
    quitarMiembro: jest.fn(),
    registrarLiquidacion: jest.fn(),
    calcularResumenCasa: jest.fn(),
    calcularSaldosCasa: jest.fn(),
    obtenerCasaParaMiembro: jest.fn(),
  };
});

const { bot } = require('../src/lib/telegraf');
const auth = require('../src/auth');
const state = require('../src/state');
const casaService = require('../src/services/casa.service');
const { beginInviteRegistration } = require('../src/services/invite.service');
const { construirResumen, formatearSaldos, fmt } = require('../src/handlers/commands/casa');
require('../src/handlers/commands/unir');

const { CasaError } = casaService;
const ENTRADA = { casaId: 'c1', ownerId: '1', nombre: 'Casa', activa: true };
const MIEMBROS = [
  { id: 'm1', userId: '1', nombre: 'Ana', rol: 'creador', estado: 'activo' },
  { id: 'm2', userId: '2', nombre: 'Beto', rol: 'miembro', estado: 'activo' },
  { id: 'm3', userId: '', nombre: 'Tomás', rol: 'miembro', estado: 'activo' },
];

function ctx(text, from = { id: 1, first_name: 'Ana' }) {
  return { from, message: { text }, reply: jest.fn().mockResolvedValue(true) };
}
const ultimo = (c) => c.reply.mock.calls.at(-1)[0];
const casa = (texto, from) => { const c = ctx(`/casa ${texto}`.trim(), from); return mockHandlers.casa(c).then(() => c); };
const unir = (texto, from) => { const c = ctx(`/unir ${texto}`, from); return mockHandlers.unir(c).then(() => c); };

beforeEach(() => {
  jest.clearAllMocks();
  state.pendingInvitacionesCasa.clear();
  auth.getIntentosCodigo.mockReturnValue(0);
  auth.obtenerClientePorUserId.mockReturnValue({ isOwner: true });
  casaService.getCasaActiva.mockReturnValue(ENTRADA);
  casaService.listarMisCasas.mockReturnValue([ENTRADA]);
  casaService.listarMiembros.mockResolvedValue(MIEMBROS);
  casaService.obtenerCasaParaMiembro.mockResolvedValue({ yo: MIEMBROS[0] });
});

describe('formato', () => {
  test('fmt: símbolos por moneda', () => {
    expect(fmt(1500)).toBe('$1.500');
    expect(fmt(20, 'Dólares')).toBe('U$20');
    expect(fmt(30.5, 'Euros')).toBe('€30,5');
  });

  test('formatearSaldos: transferencias, saldado y vacío', () => {
    expect(formatearSaldos({})).toMatch(/Todavía no hay gastos/);
    expect(formatearSaldos({ Pesos: { transferencias: [] } })).toMatch(/todo saldado/);
    const t = formatearSaldos({ Pesos: { transferencias: [{ deNombre: 'Beto', paraNombre: 'Ana', monto: 500 }] } });
    expect(t).toContain('Beto → Ana: $500');
  });

  test('construirResumen: miembros, gastos, categorías y otras casas', () => {
    const msg = construirResumen({
      casa: { nombre: 'Casa' }, mes: '2026-10', miembros: [{ nombre: 'Ana' }, { nombre: 'Beto' }],
      gastosPorMoneda: { Pesos: 1400 }, cantidad: 2, porCategoria: { supermercado: 1000, servicios: 400 },
      saldos: { Pesos: { transferencias: [] } },
    }, { otrasCasas: [{ nombre: 'Casa Dinamarca' }] });
    expect(msg).toContain('Casa');
    expect(msg).toContain('Ana, Beto');
    expect(msg).toContain('$1.400');
    expect(msg).toContain('supermercado: $1.000');
    expect(msg).toContain('Casa Dinamarca');
  });
});

describe('/casa', () => {
  test('sin casas explica cómo crear una', async () => {
    casaService.getCasaActiva.mockReturnValue(null);
    expect(ultimo(await casa(''))).toMatch(/ninguna casa/);
  });

  test('con casa muestra el resumen', async () => {
    casaService.calcularResumenCasa.mockResolvedValue({
      casa: { nombre: 'Casa' }, mes: '2026-10', miembros: MIEMBROS, gastosPorMoneda: {}, cantidad: 0,
      porCategoria: {}, saldos: {},
    });
    const c = await casa('');
    expect(casaService.calcularResumenCasa).toHaveBeenCalledWith(1, 'c1');
    expect(ultimo(c)).toContain('Sin gastos este mes');
  });

  test('subcomando desconocido muestra la ayuda', async () => {
    expect(ultimo(await casa('cualquiera'))).toContain('gastos compartidos');
  });

  test('un CasaError se traduce a un mensaje claro', async () => {
    casaService.crearCasa.mockRejectedValue(new CasaError('solo_duenos'));
    expect(ultimo(await casa('nueva Casa'))).toMatch(/propia cuenta/);
  });

  test('un error inesperado no se filtra al usuario', async () => {
    casaService.crearCasa.mockRejectedValue(new Error('boom con datos internos'));
    const msg = ultimo(await casa('nueva Casa'));
    expect(msg).toMatch(/Algo salió mal/);
    expect(msg).not.toMatch(/boom/);
  });
});

describe('/casa nueva, lista, usar', () => {
  test('nueva: usa el nombre de Telegram como alias', async () => {
    casaService.crearCasa.mockResolvedValue({ nombre: 'Casa Dinamarca' });
    const c = await casa('nueva Casa Dinamarca', { id: 1, first_name: 'Matías' });
    expect(casaService.crearCasa).toHaveBeenCalledWith(1, 'Casa Dinamarca', { alias: 'Matías' });
    expect(ultimo(c)).toContain('Casa Dinamarca');
  });

  test('lista marca la activa', async () => {
    casaService.listarMisCasas.mockReturnValue([ENTRADA, { casaId: 'c2', ownerId: '1', nombre: 'Casa Dinamarca' }]);
    const msg = ultimo(await casa('lista'));
    expect(msg).toContain('⭐ Casa');
    expect(msg).toContain('• Casa Dinamarca');
  });

  test('usar: cambia la casa; ambigua o inexistente no cambia nada', async () => {
    casaService.listarMisCasas.mockReturnValue([
      { casaId: 'c1', nombre: 'Casa' }, { casaId: 'c2', nombre: 'Casa Dinamarca' }, { casaId: 'c3', nombre: 'Casa Playa' },
    ]);
    await casa('usar casa dinamarca');
    expect(casaService.setCasaActiva).toHaveBeenCalledWith(1, 'c2');

    casaService.setCasaActiva.mockClear();
    expect(ultimo(await casa('usar Cas'))).toMatch(/más de una/);
    expect(ultimo(await casa('usar Playa'))).toMatch(/No encontré/);
    expect(casaService.setCasaActiva).not.toHaveBeenCalled();
  });
});

describe('/casa miembros y agregar', () => {
  test('miembros marca a los que no tienen Telegram y al creador', async () => {
    const msg = ultimo(await casa('miembros'));
    expect(msg).toContain('Tomás _(sin Telegram)_');
    expect(msg).toContain('Ana');
    expect(msg).toContain('👑');
  });

  test('agregar crea un miembro virtual', async () => {
    casaService.agregarMiembroVirtual.mockResolvedValue({ id: 'm9', nombre: 'Hijo' });
    await casa('agregar Hijo');
    expect(casaService.agregarMiembroVirtual).toHaveBeenCalledWith(1, 'c1', 'Hijo');
  });

  test('agregar sin nombre muestra el uso', async () => {
    expect(ultimo(await casa('agregar'))).toMatch(/Uso/);
    expect(casaService.agregarMiembroVirtual).not.toHaveBeenCalled();
  });
});

describe('invitaciones', () => {
  test('/casa invitar crea un código de un solo uso con los datos de la casa', async () => {
    const msg = ultimo(await casa('invitar'));
    const codigo = msg.match(/COD\d+/)[0];
    expect(msg).toContain(`/unir ${codigo}`);
    expect(state.pendingInvitacionesCasa.get(codigo)).toMatchObject({ ownerId: '1', casaId: 'c1', miembroId: null, creadoPor: '1' });
  });

  test('invitar a un miembro sin Telegram guarda su id; uno con Telegram se rechaza', async () => {
    const msg = ultimo(await casa('invitar tomas'));
    const codigo = msg.match(/COD\d+/)[0];
    expect(state.pendingInvitacionesCasa.get(codigo).miembroId).toBe('m3');
    expect(ultimo(await casa('invitar Beto'))).toMatch(/No encontré/); // Beto ya tiene cuenta
  });

  test('un no miembro no puede emitir invitaciones', async () => {
    casaService.obtenerCasaParaMiembro.mockRejectedValue(new CasaError('no_miembro'));
    const c = await casa('invitar');
    expect(ultimo(c)).toMatch(/No pertenecés/);
    expect(state.pendingInvitacionesCasa._map.size).toBe(0);
  });

  test('/unir con código de casa: se une con su nombre de Telegram, consume el código y avisa a quien invitó', async () => {
    state.pendingInvitacionesCasa.set('ABC234', { ownerId: '1', casaId: 'c1', casaNombre: 'Casa', miembroId: null, creadoPor: '1' });
    casaService.unirMiembro.mockResolvedValue({ casa: { nombre: 'Casa' }, miembro: { id: 'm2', nombre: 'Beto' } });

    const c = await unir('abc234', { id: 2, first_name: 'Beto' });
    expect(casaService.unirMiembro).toHaveBeenCalledWith(2, { ownerId: '1', casaId: 'c1', miembroId: null, alias: 'Beto' });
    expect(ultimo(c)).toContain('Ya sos parte de Casa');
    expect(state.pendingInvitacionesCasa.has('ABC234')).toBe(false);
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(1, expect.stringContaining('Beto se unió'));
    expect(beginInviteRegistration).not.toHaveBeenCalled();
  });

  test('/unir con alias propio y con miembro reservado', async () => {
    state.pendingInvitacionesCasa.set('XYZ234', { ownerId: '1', casaId: 'c1', casaNombre: 'Casa', miembroId: 'm3', creadoPor: '1' });
    casaService.unirMiembro.mockResolvedValue({ casa: { nombre: 'Casa' }, miembro: { id: 'm3', nombre: 'Tomás' } });
    await unir('XYZ234 Tommy', { id: 3, first_name: 'Tomás' });
    expect(casaService.unirMiembro).toHaveBeenCalledWith(3, expect.objectContaining({ miembroId: 'm3', alias: 'Tommy' }));
  });

  test('si el código falla (alias repetido) NO se consume y se sugiere otro alias', async () => {
    state.pendingInvitacionesCasa.set('ABC234', { ownerId: '1', casaId: 'c1', casaNombre: 'Casa', miembroId: null, creadoPor: '1' });
    casaService.unirMiembro.mockRejectedValue(new CasaError('nombre_repetido'));
    const c = await unir('ABC234', { id: 2, first_name: 'Ana' });
    expect(ultimo(c)).toMatch(/Unite con otro alias/);
    expect(state.pendingInvitacionesCasa.has('ABC234')).toBe(true);
  });

  test('un invitado sin cuenta propia recibe el aviso de registrarse', async () => {
    state.pendingInvitacionesCasa.set('ABC234', { ownerId: '1', casaId: 'c1', casaNombre: 'Casa', miembroId: null, creadoPor: '1' });
    casaService.unirMiembro.mockRejectedValue(new CasaError('solo_duenos'));
    expect(ultimo(await unir('ABC234', { id: 9, first_name: 'Eva' }))).toMatch(/propia cuenta/);
    expect(state.pendingInvitacionesCasa.has('ABC234')).toBe(true);
  });

  test('un código que no es de casa sigue el flujo de consultorio', async () => {
    auth.obtenerClientePorUserId.mockReturnValue(null);
    const c = await unir('NOEXISTE', { id: 7, first_name: 'Nuevo' });
    expect(beginInviteRegistration).toHaveBeenCalledWith(7, 'NOEXISTE');
    expect(ultimo(c)).toBe('flujo consultorio');
    expect(auth.incrementIntentosCodigo).not.toHaveBeenCalled(); // ese flujo ya cuenta el intento
  });

  test('un usuario con cuenta que prueba códigos inválidos suma intentos (no se puede adivinar sin límite)', async () => {
    await unir('NOEXISTE', { id: 2, first_name: 'Beto' });
    expect(auth.incrementIntentosCodigo).toHaveBeenCalledWith(2);
  });

  test('bloqueado por demasiados intentos: no canjea ni siquiera un código válido', async () => {
    state.pendingInvitacionesCasa.set('ABC234', { ownerId: '1', casaId: 'c1', casaNombre: 'Casa', miembroId: null, creadoPor: '1' });
    auth.getIntentosCodigo.mockReturnValue(99);
    expect(ultimo(await unir('ABC234', { id: 2, first_name: 'Beto' }))).toMatch(/Demasiados intentos/);
    expect(casaService.unirMiembro).not.toHaveBeenCalled();
  });

  test('/casa unir hace lo mismo y un código inválido responde claro', async () => {
    expect(ultimo(await casa('unir NOEXISTE'))).toMatch(/inválido o expirado/);
    expect(ultimo(await casa('unir'))).toMatch(/Uso/);
  });
});

describe('/casa saldo y saldar', () => {
  test('saldo muestra las transferencias', async () => {
    casaService.calcularSaldosCasa.mockResolvedValue({
      casa: { nombre: 'Casa' },
      saldos: { Pesos: { transferencias: [{ deNombre: 'Beto', paraNombre: 'Ana', monto: 300 }] } },
    });
    expect(ultimo(await casa('saldo'))).toContain('Beto → Ana: $300');
  });

  test('saldar: resuelve al miembro por nombre y registra la liquidación', async () => {
    casaService.registrarLiquidacion.mockResolvedValue({});
    casaService.calcularSaldosCasa.mockResolvedValue({ casa: { nombre: 'Casa' }, saldos: { Pesos: { transferencias: [] } } });
    const c = await casa('saldar beto 5.000', { id: 1, first_name: 'Ana' });
    expect(casaService.registrarLiquidacion).toHaveBeenCalledWith(1, 'c1', { para: 'm2', monto: 5000, moneda: 'Pesos' });
    expect(ultimo(c)).toContain('le pagaste $5.000 a *Beto*');
  });

  test('saldar con moneda', async () => {
    casaService.registrarLiquidacion.mockResolvedValue({});
    casaService.calcularSaldosCasa.mockResolvedValue({ casa: { nombre: 'Casa' }, saldos: {} });
    await casa('saldar Tomás 20 usd');
    expect(casaService.registrarLiquidacion).toHaveBeenCalledWith(1, 'c1', { para: 'm3', monto: 20, moneda: 'Dólares' });
  });

  test('saldar con sintaxis incompleta o miembro inexistente no registra nada', async () => {
    expect(ultimo(await casa('saldar Ana'))).toMatch(/Uso/);
    expect(ultimo(await casa('saldar Zoe 100'))).toMatch(/No encontré/);
    expect(casaService.registrarLiquidacion).not.toHaveBeenCalled();
  });
});

describe('/casa quitar y salir', () => {
  test('quitar resuelve al miembro por nombre', async () => {
    casaService.quitarMiembro.mockResolvedValue(true);
    await casa('quitar beto');
    expect(casaService.quitarMiembro).toHaveBeenCalledWith(1, 'c1', 'm2');
  });

  test('un error de permisos se muestra claro', async () => {
    casaService.quitarMiembro.mockRejectedValue(new CasaError('solo_creador'));
    expect(ultimo(await casa('quitar Ana'))).toMatch(/Solo quien creó/);
  });

  test('salir quita al propio miembro', async () => {
    casaService.quitarMiembro.mockResolvedValue(true);
    await casa('salir');
    expect(casaService.quitarMiembro).toHaveBeenCalledWith(1, 'c1', 'm1');
  });
});
