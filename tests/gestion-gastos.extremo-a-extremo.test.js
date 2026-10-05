// /eliminar y /editar de Personal y Casa desde el bot, de punta a punta: comando -> botones ->
// texto con el valor nuevo -> base. personal.service y el repositorio son los REALES (sobre una
// Supabase en memoria); casa.service se simula porque se prueba aparte (casa.service.test.js).

const mockCmds = {};
const mockActions = [];
const mockPermisos = new Set();   // ids con permiso editar_movimientos (consultorio)
const mockPersonal = new Set();   // ids que pueden usar Personal

jest.mock('../src/lib/telegraf', () => ({
  bot: {
    command: (name, h) => { mockCmds[name] = h; },
    action: (re, h) => { mockActions.push({ re, h }); },
    on: jest.fn(),
  },
}));
jest.mock('../src/config', () => ({ PERSONAL_STORE: 'supabase', USE_SUPABASE: true }));
jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn(() => true) }));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn().mockResolvedValue('t1') }));
jest.mock('../src/services/db.service', () => ({ ensureProfile: jest.fn().mockResolvedValue(undefined), getRows: jest.fn().mockResolvedValue([]) }));
jest.mock('../src/services/sheet.service', () => ({ invalidateCache: jest.fn() }));
jest.mock('../src/services/movimiento.service', () => ({ convertirAPesos: (m, mon) => (mon === 'Dólares' ? m * 1000 : m) }));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/auth/bot-permisos', () => ({
  tienePermisoBot: (id) => mockPermisos.has(Number(id)),
  requierePermisoBot: (ctx) => { if (mockPermisos.has(Number(ctx.from.id))) return true; ctx.reply('🔒 sin permiso'); return false; },
}));
jest.mock('../src/auth/personal-acceso', () => ({ puedeUsarPersonal: (id) => mockPersonal.has(Number(id)) }));
const mockCasa = { casas: [], movs: [], editar: jest.fn(), eliminar: jest.fn() };
jest.mock('../src/services/casa.service', () => ({
  listarMisCasas: () => mockCasa.casas,
  listarMovimientos: async () => mockCasa.movs,
  editarMovimiento: (...a) => mockCasa.editar(...a),
  eliminarMovimiento: (...a) => mockCasa.eliminar(...a),
}));

const state = require('../src/state');
const { getSupabase } = require('../src/lib/supabase');
const repo = require('../src/services/personal-repo.supabase');
const personal = require('../src/services/personal.service');
const { crearSupabaseFalso } = require('./helpers/fake-supabase');
require('../src/handlers/commands/eliminar');
require('../src/handlers/commands/editar');
require('../src/handlers/gestion-gastos');
const { procesarTextoGestion } = require('../src/handlers/gestion-gastos');

const MAMA = 7001;
const DR = 7002;
let fake;

beforeEach(() => {
  jest.clearAllMocks();
  fake = crearSupabaseFalso();
  getSupabase.mockReturnValue(fake);
  repo._reiniciarCache();
  mockPermisos.clear(); mockPersonal.clear();
  mockPersonal.add(MAMA); mockPersonal.add(DR);
  mockCasa.casas = []; mockCasa.movs = [];
  for (const id of [MAMA, DR]) state.pendingGestion.delete(id);
});

function ctx(userId, extra = {}) {
  return { from: { id: userId }, chat: { type: 'private' }, message: { text: '' }, reply: jest.fn().mockResolvedValue(true), answerCbQuery: jest.fn().mockResolvedValue(true), ...extra };
}
async function comando(nombre, userId, texto = `/${nombre}`) {
  const c = ctx(userId, { message: { text: texto } });
  await mockCmds[nombre](c);
  return c;
}
async function tocar(userId, data) {
  const a = mockActions.find((x) => x.re instanceof RegExp ? x.re.test(data) : x.re === data);
  const c = ctx(userId, { match: a.re instanceof RegExp ? a.re.exec(data) : undefined });
  await a.h(c);
  return c;
}
const botones = (c) => c.reply.mock.calls.flatMap((x) => (x[1] && x[1].reply_markup ? x[1].reply_markup.inline_keyboard.flat() : []));
const datos = (c) => botones(c).map((b) => b.callback_data);
const textos = (c) => c.reply.mock.calls.map((x) => x[0]).join('\n');
const filas = () => fake.tablas.movimientos_personales || [];

async function cargarGasto(userId, extra = {}) {
  return (await personal.registrarMovimientoPersonal(userId, { descripcion: 'Super', monto: 100, tipo: 'gasto', categoria: 'supermercado', fecha: '05/10/2026', ...extra })).movimiento.idMov;
}

describe('quien solo tiene consultorio sigue con el flujo de siempre', () => {
  test('/eliminar y /editar no preguntan ámbito', async () => {
    mockPersonal.clear(); mockPermisos.add(DR);
    const c = await comando('eliminar', DR);
    expect(textos(c)).not.toMatch(/¿De dónde/);
    expect(state.pendingGestion.has(DR)).toBe(false);
  });
});

describe('Personal de una secretaria sin permisos del consultorio (un solo ámbito)', () => {
  test('borrar: /eliminar -> lista directo -> elegir -> confirmar -> desaparece de la base', async () => {
    const id = await cargarGasto(MAMA, { descripcion: 'Pasaje a Puerto Madryn', monto: 500, moneda: 'Dólares', categoria: 'viajes' });
    await cargarGasto(DR, { descripcion: 'Gasto del doctor' });

    const lista = await comando('eliminar', MAMA);
    expect(textos(lista)).toMatch(/Personal — elegí el gasto a borrar/);
    expect(datos(lista)).toEqual(['gx_i:0', 'gx_no']); // solo SU gasto, no el del doctor
    expect(botones(lista)[0].text).toMatch(/Puerto Madryn/);

    const conf = await tocar(MAMA, 'gx_i:0');
    expect(textos(conf)).toMatch(/¿Borrar este gasto\?/);
    const fin = await tocar(MAMA, 'gx_ok');
    expect(textos(fin)).toMatch(/Borrado/);

    expect(filas().find((f) => f.legacy_id === id)).toBeUndefined();
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toMatchObject({ user_id: DR }); // el del doctor sigue ahí
  });

  test('un doble toque en "Sí, borrar" no borra dos veces ni falla', async () => {
    await cargarGasto(MAMA);
    await comando('eliminar', MAMA);
    await tocar(MAMA, 'gx_i:0');
    await tocar(MAMA, 'gx_ok');
    const segundo = await tocar(MAMA, 'gx_ok');
    expect(textos(segundo)).toMatch(/venció/);
  });

  test('editar el monto y la descripción por texto: se guarda y recalcula pesos', async () => {
    const id = await cargarGasto(MAMA, { moneda: 'Dólares', monto: 10 });
    await comando('editar', MAMA);
    const campo = await tocar(MAMA, 'gx_i:0');
    expect(datos(campo)).toEqual(expect.arrayContaining(['gx_f:d', 'gx_f:m', 'gx_f:c', 'gx_f:f']));

    const pregunta = await tocar(MAMA, 'gx_f:m');
    expect(textos(pregunta)).toMatch(/nuevo monto/);
    const c1 = ctx(MAMA);
    expect(await procesarTextoGestion(c1, '25,5')).toBe(true);
    expect(filas().find((f) => f.legacy_id === id)).toMatchObject({ monto_original: 25.5, monto_pesos: 25500, user_id: MAMA });
    expect(textos(c1)).toMatch(/Listo/);
    expect(state.pendingGestion.has(MAMA)).toBe(false);
  });

  test('un valor inválido deja la pregunta abierta para reintentar', async () => {
    const id = await cargarGasto(MAMA);
    await comando('editar', MAMA);
    await tocar(MAMA, 'gx_i:0');
    await tocar(MAMA, 'gx_f:m');
    const malo = ctx(MAMA);
    await procesarTextoGestion(malo, 'mucho');
    expect(textos(malo)).toMatch(/monto es inválido/);
    expect(state.pendingGestion.has(MAMA)).toBe(true);
    await procesarTextoGestion(ctx(MAMA), '0');
    expect(filas().find((f) => f.legacy_id === id).monto_original).toBe(100);
    await procesarTextoGestion(ctx(MAMA), '250');
    expect(filas().find((f) => f.legacy_id === id).monto_original).toBe(250);
  });

  test('cambiar fecha ("hoy" y DD/MM/AAAA) y descripción', async () => {
    const id = await cargarGasto(MAMA);
    await comando('editar', MAMA);
    await tocar(MAMA, 'gx_i:0'); await tocar(MAMA, 'gx_f:f');
    const mala = ctx(MAMA);
    await procesarTextoGestion(mala, '31/02/2026');
    expect(textos(mala)).toMatch(/No entendí la fecha/);
    await procesarTextoGestion(ctx(MAMA), '03/10/2026');
    expect(filas().find((f) => f.legacy_id === id).fecha).toBe('2026-10-03');

    await comando('editar', MAMA);
    await tocar(MAMA, 'gx_i:0'); await tocar(MAMA, 'gx_f:d');
    await procesarTextoGestion(ctx(MAMA), 'Super Coto');
    expect(filas().find((f) => f.legacy_id === id).descripcion).toBe('Super Coto');
  });

  test('cambiar la categoría con botones (solo las del tipo del movimiento)', async () => {
    const id = await cargarGasto(MAMA);
    await comando('editar', MAMA);
    await tocar(MAMA, 'gx_i:0');
    const cats = await tocar(MAMA, 'gx_f:c');
    const idx = botones(cats).findIndex((b) => b.text === 'salud');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(botones(cats).map((b) => b.text)).not.toContain('sueldo'); // categoría de ingreso
    await tocar(MAMA, `gx_c:${idx}`);
    expect(filas().find((f) => f.legacy_id === id).categoria).toBe('salud');
  });

  test('NO se puede tocar el gasto de otra persona aunque se fuerce el índice o el estado', async () => {
    const idDr = await cargarGasto(DR, { descripcion: 'Del doctor', monto: 777 });
    await comando('editar', MAMA);
    // MAMA no tiene gastos propios -> no hay nada que elegir
    expect(state.pendingGestion.has(MAMA)).toBe(false);
    const fuerza = await tocar(MAMA, 'gx_i:0');
    expect(textos(fuerza)).toMatch(/venció/);
    expect(filas().find((f) => f.legacy_id === idDr)).toMatchObject({ monto_original: 777, descripcion: 'Del doctor' });
  });

  test('/cancelar y los textos sueltos con un botón pendiente', async () => {
    await cargarGasto(MAMA);
    await comando('eliminar', MAMA);
    const c = ctx(MAMA);
    expect(await procesarTextoGestion(c, 'hola')).toBe(true);
    expect(textos(c)).toMatch(/operación pendiente/);
    await tocar(MAMA, 'gx_no');
    expect(state.pendingGestion.has(MAMA)).toBe(false);
    expect(await procesarTextoGestion(ctx(MAMA), 'hola')).toBe(false); // ya no intercepta nada
  });
});

describe('con consultorio, Personal y Casa se pregunta de dónde', () => {
  beforeEach(() => {
    mockPermisos.add(DR);
    mockCasa.casas = [{ casaId: 'casa_1', nombre: 'Casa Dinamarca' }];
  });

  test('ofrece los tres ámbitos', async () => {
    const c = await comando('eliminar', DR);
    expect(textos(c)).toMatch(/¿De dónde querés borrar un gasto\?/);
    expect(botones(c).map((b) => b.text)).toEqual(['🏥 Consultorio', '🏠 Personal', '🏡 Casa Dinamarca']);
  });

  test('Casa: lista los gastos, edita con el servicio y respeta sus errores de permiso', async () => {
    mockCasa.movs = [
      { idMov: 'cmov_1', descripcion: 'Super', monto: 900, moneda: 'Pesos', fecha: '05/10/2026', tipo: 'gasto', categoria: 'supermercado' },
      { idMov: 'cmov_2', descripcion: 'Ana le pagó a Beto', monto: 100, moneda: 'Pesos', fecha: '04/10/2026', tipo: 'liquidacion' },
    ];
    await comando('editar', DR);
    const lista = await tocar(DR, 'gx_a:2');
    expect(datos(lista)).toEqual(['gx_i:0', 'gx_i:1', 'gx_no']);

    // una liquidación no se edita
    const liq = await tocar(DR, 'gx_i:1');
    expect(textos(liq)).toMatch(/no se edita/);

    await tocar(DR, 'gx_i:0');
    await tocar(DR, 'gx_f:m');
    mockCasa.editar.mockResolvedValueOnce({ descripcion: 'Super', monto: 1200, moneda: 'Pesos', fecha: '05/10/2026' });
    await procesarTextoGestion(ctx(DR), '1200');
    expect(mockCasa.editar).toHaveBeenCalledWith(DR, 'casa_1', 'cmov_1', { monto: 1200 });
  });

  test('Casa: un error de permiso del servicio se explica y cierra el flujo', async () => {
    mockCasa.movs = [{ idMov: 'cmov_1', descripcion: 'Super', monto: 900, moneda: 'Pesos', fecha: '05/10/2026', tipo: 'gasto' }];
    await comando('eliminar', DR);
    await tocar(DR, 'gx_a:2'); await tocar(DR, 'gx_i:0');
    const err = new Error('x'); err.code = 'sin_permiso';
    mockCasa.eliminar.mockRejectedValueOnce(err);
    const fin = await tocar(DR, 'gx_ok');
    expect(textos(fin)).toMatch(/Solo quien lo cargó o quien creó la casa/);
    expect(state.pendingGestion.has(DR)).toBe(false);
  });

  test('Casa: borrar llama al servicio con la identidad de quien toca', async () => {
    mockCasa.movs = [{ idMov: 'cmov_1', descripcion: 'Super', monto: 900, moneda: 'Pesos', fecha: '05/10/2026', tipo: 'gasto' }];
    mockCasa.eliminar.mockResolvedValueOnce(true);
    await comando('eliminar', DR);
    await tocar(DR, 'gx_a:2'); await tocar(DR, 'gx_i:0');
    const fin = await tocar(DR, 'gx_ok');
    expect(mockCasa.eliminar).toHaveBeenCalledWith(DR, 'casa_1', 'cmov_1');
    expect(textos(fin)).toMatch(/Borrado/);
  });

  test('"Consultorio" sigue con el flujo de siempre y sale de este módulo', async () => {
    await comando('eliminar', DR);
    const c = await tocar(DR, 'gx_a:0');
    expect(state.pendingGestion.has(DR)).toBe(false);
    expect(textos(c)).toMatch(/No hay movimientos registrados/); // db.getRows simulado vacío: es el flujo legado
  });
});
