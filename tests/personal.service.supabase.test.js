// personal.service en modo PERSONAL_STORE=supabase: todo por persona, sin tocar NUNCA el Sheet.

jest.mock('../src/config', () => ({ PERSONAL_STORE: 'supabase', USE_SUPABASE: true }));
jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn(() => true) }));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn().mockResolvedValue('t1') }));
jest.mock('../src/services/db.service', () => ({ ensureProfile: jest.fn().mockResolvedValue(undefined) }));
// Trampa: si el modo Supabase toca el Sheet por error, el test falla.
jest.mock('../src/services/sheet-tab.service', () => ({
  getOrCreateTab: jest.fn(() => { throw new Error('NO debe tocar el Sheet en modo supabase'); }),
}));
jest.mock('../src/services/sheet.service', () => ({ invalidateCache: jest.fn() }));
jest.mock('../src/services/movimiento.service', () => ({ convertirAPesos: (m, mon) => (mon === 'Dólares' ? m * 1000 : m) }));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { getSupabase } = require('../src/lib/supabase');
const sheetTab = require('../src/services/sheet-tab.service');
const svc = require('../src/services/personal.service');
const repo = require('../src/services/personal-repo.supabase');
const { crearSupabaseFalso } = require('./helpers/fake-supabase');

const ANA = 1001;
const BETO = 2002;
let fake;

function iniciar(opts) { fake = crearSupabaseFalso(opts); getSupabase.mockReturnValue(fake); }
beforeEach(() => { jest.clearAllMocks(); repo._reiniciarCache(); iniciar(); });
afterEach(() => expect(sheetTab.getOrCreateTab).not.toHaveBeenCalled());

describe('movimientos', () => {
  test('registrar guarda en la base a nombre de la persona y devuelve la misma forma de siempre', async () => {
    const { movimiento, viaje } = await svc.registrarMovimientoPersonal(ANA, {
      descripcion: 'Pasaje a Puerto Madryn', monto: 500, tipo: 'gasto', moneda: 'Dólares', categoria: 'viajes', fecha: '05/10/2026',
    });
    expect(movimiento).toMatchObject({ descripcion: 'Pasaje a Puerto Madryn', monto: 500, tipo: 'Egreso', moneda: 'Dólares', montoPesos: 500000, categoria: 'viajes' });
    expect(movimiento.idMov).toMatch(/^pers_/);
    expect(viaje).toBeNull();

    const [fila] = fake.tablas.movimientos_personales;
    expect(fila).toMatchObject({ user_id: ANA, created_by: ANA, tenant_id: 't1', tipo_movimiento: 'egreso', categoria: 'viajes', fecha: '2026-10-05' });
  });

  test('cargadoPor: quién lo cargó se registra aparte (la secretaria cargando por otra persona)', async () => {
    await svc.registrarMovimientoPersonal(ANA, { descripcion: 'Super', monto: 100, categoria: 'supermercado', cargadoPor: 3003 });
    expect(fake.tablas.movimientos_personales[0]).toMatchObject({ user_id: ANA, created_by: 3003 });
  });

  test('las mismas validaciones de siempre', async () => {
    await expect(svc.registrarMovimientoPersonal(ANA, { descripcion: 'x1', monto: 0, categoria: 'otros' })).rejects.toThrow('monto_invalido');
    await expect(svc.registrarMovimientoPersonal(ANA, { descripcion: 'x', monto: 5, categoria: 'otros' })).rejects.toThrow('descripcion_invalida');
    expect(fake.tablas.movimientos_personales || []).toHaveLength(0);
  });

  test('obtener y eliminar', async () => {
    const { movimiento } = await svc.registrarMovimientoPersonal(ANA, { descripcion: 'Super', monto: 100, categoria: 'supermercado' });
    expect(await svc.obtenerMovimientosPersonales(ANA)).toHaveLength(1);
    expect(await svc.eliminarMovimientoPersonal(ANA, movimiento.idMov)).toBe(true);
    expect(await svc.eliminarMovimientoPersonal(ANA, movimiento.idMov)).toBe(false);
    expect(await svc.obtenerMovimientosPersonales(ANA)).toEqual([]);
  });

  test('un ingreso con categoría de ingreso', async () => {
    const { movimiento } = await svc.registrarMovimientoPersonal(ANA, { descripcion: 'Sueldo', monto: 1000, tipo: 'ingreso', categoria: 'sueldo' });
    expect(movimiento.tipo).toBe('Ingreso');
  });
});

describe('AISLAMIENTO entre personas (a través del servicio)', () => {
  test('cada una ve solo lo suyo y su resumen no incluye lo del otro', async () => {
    await svc.registrarMovimientoPersonal(ANA, { descripcion: 'Pasaje', monto: 100, categoria: 'viajes', fecha: '05/10/2026' });
    await svc.registrarMovimientoPersonal(BETO, { descripcion: 'Cena', monto: 50, categoria: 'comida_afuera', fecha: '06/10/2026' });

    const ra = await svc.calcularResumenPersonal(ANA, '2026-10');
    const rb = await svc.calcularResumenPersonal(BETO, '2026-10');
    expect(ra.egresos).toBe(100);
    expect(rb.egresos).toBe(50);
    expect(ra.movimientos.map(m => m.descripcion)).toEqual(['Pasaje']);
    expect(rb.movimientos.map(m => m.descripcion)).toEqual(['Cena']);
  });

  test('no se puede borrar el movimiento de otra persona, ni sabiendo su id', async () => {
    const { movimiento } = await svc.registrarMovimientoPersonal(ANA, { descripcion: 'Pasaje', monto: 100, categoria: 'viajes' });
    expect(await svc.eliminarMovimientoPersonal(BETO, movimiento.idMov)).toBe(false);
    expect(await svc.obtenerMovimientosPersonales(ANA)).toHaveLength(1);
  });

  test('presupuestos, viajes y preferencias también son por persona', async () => {
    await svc.guardarPresupuesto(ANA, 'viajes', 100000);
    expect(await svc.obtenerPresupuestos(BETO)).toEqual([]);
    await svc.crearViaje(ANA, { nombre: 'Madryn' });
    expect(await svc.obtenerViajeActivo(BETO)).toBeNull();
    await svc.guardarPreferencia(ANA, 'naturgy', 'personal');
    expect(await svc.leerPreferencias(BETO)).toEqual({});
  });
});

describe('resumen del mes', () => {
  test('totales, balance y por categoría', async () => {
    await svc.registrarMovimientoPersonal(ANA, { descripcion: 'Sueldo', monto: 1000, tipo: 'ingreso', categoria: 'sueldo', fecha: '01/10/2026' });
    await svc.registrarMovimientoPersonal(ANA, { descripcion: 'Super', monto: 200, categoria: 'supermercado', fecha: '02/10/2026' });
    await svc.registrarMovimientoPersonal(ANA, { descripcion: 'Viejo', monto: 999, categoria: 'otros', fecha: '02/09/2026' });
    const r = await svc.calcularResumenPersonal(ANA, '2026-10');
    expect(r).toMatchObject({ ingresos: 1000, egresos: 200, balance: 800, cantidad: 2 });
    expect(r.porCategoria).toEqual([{ categoria: 'supermercado', total: 200, porcentaje: 100 }]);
  });
});

describe('viajes', () => {
  test('un gasto dentro del viaje activo se atribuye; uno doméstico (servicios) no; y se respeta la decisión explícita', async () => {
    await svc.crearViaje(ANA, { nombre: 'Madryn', fechaInicio: '01/10/2026', fechaFin: '20/10/2026' });
    const a = await svc.registrarMovimientoPersonal(ANA, { descripcion: 'Hotel', monto: 100, categoria: 'viajes', fecha: '05/10/2026' });
    const b = await svc.registrarMovimientoPersonal(ANA, { descripcion: 'Luz', monto: 10, categoria: 'servicios', fecha: '05/10/2026' });
    const c = await svc.registrarMovimientoPersonal(ANA, { descripcion: 'Taxi', monto: 10, categoria: 'transporte', fecha: '05/10/2026', viajeId: null });
    expect(a.movimiento.viajeId).toBeTruthy();
    expect(a.viaje.nombre).toBe('Madryn');
    expect(b.movimiento.viajeId).toBeNull();
    expect(c.movimiento.viajeId).toBeNull();
  });

  test('crear, ver y cerrar', async () => {
    const v = await svc.crearViaje(ANA, { nombre: 'Madryn' });
    expect(v.idViaje).toMatch(/^viaje_/);
    expect((await svc.obtenerViajeActivo(ANA)).nombre).toBe('Madryn');
    expect((await svc.cerrarViaje(ANA)).nombre).toBe('Madryn');
    expect(await svc.cerrarViaje(ANA)).toBeNull();
  });
});

describe('presupuestos', () => {
  test('guardar, evaluar el aviso y desactivar con monto 0', async () => {
    await svc.guardarPresupuesto(ANA, 'supermercado', 1000);
    await svc.registrarMovimientoPersonal(ANA, { descripcion: 'Super', monto: 900, categoria: 'supermercado', fecha: '05/10/2026' });
    const estado = await svc.evaluarPresupuesto(ANA, 'supermercado', '05/10/2026');
    expect(estado).toMatchObject({ gastado: 900, limite: 1000, porcentaje: 90, enAlerta: true });

    await svc.guardarPresupuesto(ANA, 'supermercado', 0);
    expect(await svc.evaluarPresupuesto(ANA, 'supermercado', '05/10/2026')).toBeNull();
  });

  test('validaciones', async () => {
    await expect(svc.guardarPresupuesto(ANA, '', 5)).rejects.toThrow('categoria_invalida');
    await expect(svc.guardarPresupuesto(ANA, 'ropa', -1)).rejects.toThrow('monto_invalido');
  });
});

describe('preferencias de ámbito', () => {
  test('guardar y leer, incluida una casa; un ámbito inválido se rechaza', async () => {
    expect(await svc.guardarPreferencia(ANA, 'luz', 'personal')).toBe(true);
    expect(await svc.guardarPreferencia(ANA, 'naturgy', 'casa:casa_1_abcd')).toBe(true);
    expect(await svc.guardarPreferencia(ANA, 'x', 'cualquiera')).toBe(false);
    expect(await svc.leerPreferencias(ANA)).toEqual({ luz: 'personal', naturgy: 'casa:casa_1_abcd' });
  });
});

describe('errores de la base', () => {
  test('al GUARDAR se propagan: el usuario no cree que se guardó algo que no se guardó', async () => {
    iniciar({ errorEn: { tabla: 'movimientos_personales', op: 'insert', mensaje: 'check constraint' } });
    await expect(svc.registrarMovimientoPersonal(ANA, { descripcion: 'Super', monto: 5, categoria: 'supermercado' }))
      .rejects.toMatchObject({ code: 'personal_db_error' });
  });

  test('al LEER datos principales se propagan', async () => {
    iniciar({ errorEn: { tabla: 'movimientos_personales', op: 'select' } });
    await expect(svc.obtenerMovimientosPersonales(ANA)).rejects.toMatchObject({ code: 'personal_db_error' });
    await expect(svc.calcularResumenPersonal(ANA, '2026-10')).rejects.toMatchObject({ code: 'personal_db_error' });
  });

  test('el aviso de presupuesto es decorativo: si falla NO hace parecer que el guardado falló', async () => {
    await svc.guardarPresupuesto(ANA, 'supermercado', 1000);
    iniciar({ errorEn: { tabla: 'presupuestos_personales', op: 'select' } });
    await expect(svc.evaluarPresupuesto(ANA, 'supermercado', '05/10/2026')).resolves.toBeNull();
  });

  test('las preferencias son no críticas: si fallan se devuelve vacío, no se rompe la carga de un movimiento', async () => {
    iniciar({ errorEn: { tabla: 'preferencias_ambito_personales', op: 'select' } });
    expect(await svc.leerPreferencias(ANA)).toEqual({});
  });
});
