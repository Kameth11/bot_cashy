// Repositorio de Personal sobre Supabase, contra un Supabase falso en memoria.

jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn(() => true) }));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn() }));
jest.mock('../src/services/db.service', () => ({ ensureProfile: jest.fn().mockResolvedValue(undefined) }));

const { getSupabase } = require('../src/lib/supabase');
const { resolveTenantId } = require('../src/services/tenant.service');
const { ensureProfile } = require('../src/services/db.service');
const repo = require('../src/services/personal-repo.supabase');
const { crearSupabaseFalso } = require('./helpers/fake-supabase');

const ANA = 1001;   // dos personas del MISMO consultorio (mismo tenant)
const BETO = 2002;

let fake;
function iniciar(opts) {
  fake = crearSupabaseFalso(opts);
  getSupabase.mockReturnValue(fake);
  resolveTenantId.mockResolvedValue('t1');
}
beforeEach(() => {
  jest.clearAllMocks();
  repo._reiniciarCache();
  iniciar();
});

const gasto = (extra = {}) => ({
  idMov: 'pers_1_aaaa', fecha: '05/10/2026', hora: '14:30', descripcion: 'Pasaje a Puerto Madryn', monto: 500, tipo: 'Egreso',
  moneda: 'Dólares', montoPesos: 500000, metodoPago: 'tarjeta', categoria: 'viajes', comercio: 'Aerolíneas', viajeId: null, notas: null,
  origenCarga: 'bot', ...extra,
});

describe('movimientos', () => {
  test('guarda y lee con las MISMAS formas que el camino del Sheet', async () => {
    await repo.insertarMovimiento(ANA, gasto());
    const [m] = await repo.listarMovimientos(ANA);
    expect(m).toEqual({
      idMov: 'pers_1_aaaa', fecha: '05/10/2026', hora: '14:30', descripcion: 'Pasaje a Puerto Madryn', monto: 500,
      tipo: 'Egreso', moneda: 'Dólares', montoPesos: 500000, metodoPago: 'tarjeta', categoria: 'viajes',
      comercio: 'Aerolíneas', viajeId: null, notas: null,
    });
  });

  test('un ingreso vuelve como "Ingreso"', async () => {
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'i1', tipo: 'Ingreso', categoria: 'sueldo', moneda: 'Pesos' }));
    expect((await repo.listarMovimientos(ANA))[0].tipo).toBe('Ingreso');
  });

  test('created_by: por defecto quien lo cargó es la propia persona; se puede indicar otro (la secretaria)', async () => {
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'a' }));
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'b' }), { createdBy: 3003 });
    const [a, b] = fake.tablas.movimientos_personales;
    expect(a.created_by).toBe(ANA);
    expect(b.created_by).toBe(3003);
    expect(b.user_id).toBe(ANA); // el Personal sigue siendo de Ana
  });

  test('método de pago: válidos pasan, desconocidos van a "otro", ausente queda null', async () => {
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'a', metodoPago: 'debito' }));
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'b', metodoPago: 'cheque' }));
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'c', metodoPago: null }));
    expect(fake.tablas.movimientos_personales.map(f => f.metodo_pago)).toEqual(['debito', 'otro', null]);
  });

  test('origen de carga: "dashboard" y "comprobante" son válidos; uno desconocido cae en "bot"', async () => {
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'a', origenCarga: 'dashboard' }));
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'b', origenCarga: 'comprobante' }));
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'c', origenCarga: 'raro' }));
    expect(fake.tablas.movimientos_personales.map(f => f.origen_carga)).toEqual(['dashboard', 'comprobante', 'bot']);
  });

  test('una fecha ilegible no manda fecha (rige el DEFAULT de la base)', async () => {
    await repo.insertarMovimiento(ANA, gasto({ fecha: 'ayer' }));
    expect(fake.tablas.movimientos_personales[0]).not.toHaveProperty('fecha');
  });

  test('ordena del más nuevo al más viejo', async () => {
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'a', fecha: '01/10/2026' }));
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'b', fecha: '20/10/2026' }));
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'c', fecha: '10/10/2026' }));
    expect((await repo.listarMovimientos(ANA)).map(m => m.idMov)).toEqual(['b', 'c', 'a']);
  });

  test('pagina: no pierde historial pasadas las 1000 filas', async () => {
    const filas = Array.from({ length: 2300 }, (_, i) => ({
      id: `u${i}`, user_id: ANA, tenant_id: 't1', legacy_id: `l${i}`, tipo_movimiento: 'egreso', categoria: 'otros',
      descripcion: 'x', monto_original: 1, monto_pesos: 1, moneda: 'Pesos', fecha: '2026-10-01',
    }));
    fake.tablas.movimientos_personales = filas;
    expect(await repo.listarMovimientos(ANA)).toHaveLength(2300);
  });

  test('eliminar por id de movimiento; uno inexistente devuelve false', async () => {
    await repo.insertarMovimiento(ANA, gasto());
    expect(await repo.eliminarMovimiento(ANA, 'pers_1_aaaa')).toBe(true);
    expect(await repo.listarMovimientos(ANA)).toEqual([]);
    expect(await repo.eliminarMovimiento(ANA, 'pers_1_aaaa')).toBe(false);
  });

  test('eliminar acepta también el UUID de la fila', async () => {
    await repo.insertarMovimiento(ANA, gasto());
    const { id } = fake.tablas.movimientos_personales[0];
    fake.tablas.movimientos_personales[0].id = '123e4567-e89b-12d3-a456-426614174000';
    expect(await repo.eliminarMovimiento(ANA, '123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(id).toBeDefined();
  });
});

describe('AISLAMIENTO entre dos personas del mismo consultorio', () => {
  test('cada una ve solo lo suyo', async () => {
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'ana-1' }));
    await repo.insertarMovimiento(BETO, gasto({ idMov: 'beto-1', descripcion: 'Cena' }));
    expect((await repo.listarMovimientos(ANA)).map(m => m.idMov)).toEqual(['ana-1']);
    expect((await repo.listarMovimientos(BETO)).map(m => m.idMov)).toEqual(['beto-1']);
  });

  test('una persona no puede borrar el movimiento de otra, ni sabiendo su id', async () => {
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'ana-1' }));
    expect(await repo.eliminarMovimiento(BETO, 'ana-1')).toBe(false);
    expect(await repo.listarMovimientos(ANA)).toHaveLength(1);
  });

  test('cada una tiene su propio viaje activo, sus presupuestos y sus preferencias', async () => {
    await repo.crearViaje(ANA, { idViaje: 'v-ana', nombre: 'Madryn' });
    await repo.crearViaje(BETO, { idViaje: 'v-beto', nombre: 'Bariloche' });
    expect((await repo.obtenerViajeActivo(ANA)).nombre).toBe('Madryn');
    expect((await repo.obtenerViajeActivo(BETO)).nombre).toBe('Bariloche');

    await repo.guardarPresupuesto(ANA, 'supermercado', 100000);
    expect(await repo.listarPresupuestos(BETO)).toEqual([]);

    await repo.guardarPreferencia(ANA, 'naturgy', 'personal');
    expect(await repo.leerPreferencias(BETO)).toEqual({});
    expect(await repo.leerPreferencias(ANA)).toEqual({ naturgy: 'personal' });
  });

  test('cerrar el viaje de una persona no toca el de la otra', async () => {
    await repo.crearViaje(ANA, { idViaje: 'v-ana', nombre: 'Madryn' });
    await repo.crearViaje(BETO, { idViaje: 'v-beto', nombre: 'Bariloche' });
    await repo.cerrarViaje(ANA);
    expect(await repo.obtenerViajeActivo(ANA)).toBeNull();
    expect((await repo.obtenerViajeActivo(BETO)).nombre).toBe('Bariloche');
  });

  test('en otro consultorio (otro tenant) tampoco se ve', async () => {
    await repo.insertarMovimiento(ANA, gasto({ idMov: 'ana-1' }));
    resolveTenantId.mockResolvedValue('t2');
    expect(await repo.listarMovimientos(ANA)).toEqual([]);
  });
});

describe('viajes', () => {
  test('crear, leer (fechas DD/MM/YYYY) y cerrar', async () => {
    await repo.crearViaje(ANA, { idViaje: 'v1', nombre: 'Madryn', fechaInicio: '10/01/2026', fechaFin: '20/01/2026', presupuesto: 800000, moneda: 'Pesos' });
    expect(await repo.obtenerViajeActivo(ANA)).toEqual({
      idViaje: 'v1', nombre: 'Madryn', fechaInicio: '10/01/2026', fechaFin: '20/01/2026', presupuesto: 800000, moneda: 'Pesos',
    });
    expect((await repo.cerrarViaje(ANA)).idViaje).toBe('v1');
    expect(await repo.obtenerViajeActivo(ANA)).toBeNull();
  });

  test('un segundo viaje activo de la misma persona se rechaza con un error claro', async () => {
    await repo.crearViaje(ANA, { idViaje: 'v1', nombre: 'Uno' });
    await expect(repo.crearViaje(ANA, { idViaje: 'v2', nombre: 'Dos' })).rejects.toMatchObject({ code: 'viaje_activo_existente' });
  });

  test('tras cerrar se puede abrir otro', async () => {
    await repo.crearViaje(ANA, { idViaje: 'v1', nombre: 'Uno' });
    await repo.cerrarViaje(ANA);
    await expect(repo.crearViaje(ANA, { idViaje: 'v2', nombre: 'Dos' })).resolves.toMatchObject({ idViaje: 'v2' });
  });

  test('cerrar sin viaje activo devuelve null', async () => {
    expect(await repo.cerrarViaje(ANA)).toBeNull();
  });

  test('sin presupuesto ni fechas queda null / vacío', async () => {
    await repo.crearViaje(ANA, { idViaje: 'v1', nombre: 'Uno' });
    expect(await repo.obtenerViajeActivo(ANA)).toMatchObject({ presupuesto: null, fechaInicio: '', fechaFin: '' });
  });
});

describe('presupuestos', () => {
  test('guardar y actualizar (upsert por categoría)', async () => {
    await repo.guardarPresupuesto(ANA, 'supermercado', 100000);
    await repo.guardarPresupuesto(ANA, 'supermercado', 150000, 'Pesos');
    expect(await repo.listarPresupuestos(ANA)).toEqual([{ categoria: 'supermercado', montoMensual: 150000, moneda: 'Pesos' }]);
    expect(fake.tablas.presupuestos_personales).toHaveLength(1);
  });

  test('monto 0 DESACTIVA sin borrar (la tabla exige monto > 0), y se puede reactivar', async () => {
    await repo.guardarPresupuesto(ANA, 'ropa', 50000);
    await repo.guardarPresupuesto(ANA, 'ropa', 0);
    expect(await repo.listarPresupuestos(ANA)).toEqual([]);
    expect(fake.tablas.presupuestos_personales).toHaveLength(1);
    expect(fake.tablas.presupuestos_personales[0].activo).toBe(false);

    await repo.guardarPresupuesto(ANA, 'ropa', 70000);
    expect(await repo.listarPresupuestos(ANA)).toEqual([{ categoria: 'ropa', montoMensual: 70000, moneda: 'Pesos' }]);
  });

  test('desactivar uno que no existe no falla', async () => {
    await expect(repo.guardarPresupuesto(ANA, 'ropa', 0)).resolves.toBeUndefined();
  });
});

describe('preferencias', () => {
  test('guardar, sobrescribir y leer', async () => {
    await repo.guardarPreferencia(ANA, 'luz', 'consultorio');
    await repo.guardarPreferencia(ANA, 'luz', 'personal');
    await repo.guardarPreferencia(ANA, 'naturgy', 'casa:casa_1_abcd');
    expect(await repo.leerPreferencias(ANA)).toEqual({ luz: 'personal', naturgy: 'casa:casa_1_abcd' });
    expect(fake.tablas.preferencias_ambito_personales).toHaveLength(2);
  });
});

describe('errores: SE PROPAGAN (antes se tragaban y el usuario creía que se había guardado)', () => {
  test('un error de la base al insertar llega a quien llama', async () => {
    iniciar({ errorEn: { tabla: 'movimientos_personales', op: 'insert', mensaje: 'violates check constraint' } });
    await expect(repo.insertarMovimiento(ANA, gasto())).rejects.toMatchObject({ code: 'personal_db_error' });
    await expect(repo.insertarMovimiento(ANA, gasto())).rejects.toThrow(/violates check constraint/);
  });

  test('un error al leer también', async () => {
    iniciar({ errorEn: { tabla: 'movimientos_personales', op: 'select' } });
    await expect(repo.listarMovimientos(ANA)).rejects.toMatchObject({ code: 'personal_db_error' });
  });

  test('sin tenant resuelto: error claro, no un insert sin aislamiento', async () => {
    resolveTenantId.mockResolvedValue(null);
    await expect(repo.listarMovimientos(ANA)).rejects.toMatchObject({ code: 'personal_sin_tenant' });
    expect(fake.llamadas).toHaveLength(0);
  });

  test('sin Supabase configurado: error claro', async () => {
    getSupabase.mockReturnValue(null);
    await expect(repo.listarMovimientos(ANA)).rejects.toMatchObject({ code: 'personal_sin_supabase' });
  });
});

describe('perfil', () => {
  test('asegura el perfil (la FK lo exige) una sola vez por persona', async () => {
    await repo.listarMovimientos(ANA);
    await repo.listarMovimientos(ANA);
    await repo.listarMovimientos(BETO);
    expect(ensureProfile).toHaveBeenCalledTimes(2);
  });
});

describe('conversión', () => {
  test('isoADdmm', () => {
    expect(repo.isoADdmm('2026-10-05')).toBe('05/10/2026');
    expect(repo.isoADdmm('2026-10-05T12:00:00Z')).toBe('05/10/2026');
    expect(repo.isoADdmm(null)).toBeNull();
    expect(repo.isoADdmm('x')).toBeNull();
  });
});
