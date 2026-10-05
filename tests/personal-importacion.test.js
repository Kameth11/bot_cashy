jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn(() => true) }));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn().mockResolvedValue('t1') }));
jest.mock('../src/services/db.service', () => ({ ensureProfile: jest.fn().mockResolvedValue(undefined) }));

const { getSupabase } = require('../src/lib/supabase');
const repo = require('../src/services/personal-repo.supabase');
const imp = require('../src/services/personal-importacion');
const { crearSupabaseFalso } = require('./helpers/fake-supabase');

const USER = 5555;
let fake;
beforeEach(() => { fake = crearSupabaseFalso(); getSupabase.mockReturnValue(fake); repo._reiniciarCache(); });

const mov = (extra = {}) => ({
  idMov: 'pers_1_aaaa', fecha: '05/03/2026', hora: '10:30', descripcion: 'Supermercado', monto: 12000, tipo: 'Egreso',
  moneda: 'Pesos', montoPesos: 12000, metodoPago: 'tarjeta', categoria: 'supermercado', comercio: 'Coto', viajeId: null, notas: null, ...extra,
});

describe('mapearMovimiento', () => {
  test('un movimiento normal pasa tal cual, marcado como importado', () => {
    const r = imp.mapearMovimiento(mov(), USER);
    expect(r.ok).toBe(true);
    expect(r.movimiento).toMatchObject({ idMov: 'pers_1_aaaa', monto: 12000, tipo: 'Egreso', categoria: 'supermercado', origenCarga: 'migracion' });
    expect(r.aviso).toBeUndefined();
  });

  test.each([
    [{ monto: 0 }, 'monto_invalido'],
    [{ monto: 'abc' }, 'monto_invalido'],
    [{ fecha: null }, 'fecha_ilegible'],
    [{ fecha: 'ayer' }, 'fecha_ilegible'],
  ])('se descarta %j -> %s (nunca se importa con la fecha de hoy)', (extra, motivo) => {
    expect(imp.mapearMovimiento(mov(extra), USER)).toEqual({ ok: false, motivo });
  });

  test('categoría que la base rechazaría: va a "otros" (egreso) u "otro_ingreso" y se avisa', () => {
    const e = imp.mapearMovimiento(mov({ categoria: 'inventada' }), USER);
    expect(e.movimiento.categoria).toBe('otros');
    expect(e.aviso).toMatch(/categoria_ajustada/);
    const i = imp.mapearMovimiento(mov({ tipo: 'Ingreso', categoria: 'supermercado' }), USER);
    expect(i.movimiento.categoria).toBe('otro_ingreso'); // una categoría de egreso en un ingreso violaría el CHECK
  });

  test('moneda: variantes se normalizan, desconocida = Pesos', () => {
    expect(imp.mapearMovimiento(mov({ moneda: 'Dolares' }), USER).movimiento.moneda).toBe('Dólares');
    expect(imp.mapearMovimiento(mov({ moneda: 'USD' }), USER).movimiento.moneda).toBe('Dólares');
    expect(imp.mapearMovimiento(mov({ moneda: 'euros' }), USER).movimiento.moneda).toBe('Euros');
    expect(imp.mapearMovimiento(mov({ moneda: '???' }), USER).movimiento.moneda).toBe('Pesos');
  });

  test('sin montoPesos usa el monto', () => {
    expect(imp.mapearMovimiento(mov({ montoPesos: null }), USER).movimiento.montoPesos).toBe(12000);
  });

  test('una fila sin ID (cargada a mano) recibe un id determinístico: reimportar no duplica', () => {
    const a = imp.mapearMovimiento(mov({ idMov: null }), USER).movimiento.idMov;
    const b = imp.mapearMovimiento(mov({ idMov: null }), USER).movimiento.idMov;
    const otra = imp.mapearMovimiento(mov({ idMov: null, monto: 99 }), USER).movimiento.idMov;
    expect(a).toMatch(/^mig_[0-9a-f]{16}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(otra);
    expect(imp.mapearMovimiento(mov({ idMov: null }), 9999).movimiento.idMov).not.toBe(a); // y es por persona
  });
});

describe('viajes, presupuestos y preferencias', () => {
  test('viajes: estado normalizado y presupuesto vacío = null', () => {
    const v = imp.mapearViaje({ idViaje: 'v1', nombre: 'Brasil', fechaInicio: '10/01/2026', estado: 'Cerrado', presupuesto: '', moneda: 'Pesos' }, USER);
    expect(v.viaje).toMatchObject({ idViaje: 'v1', estado: 'cerrado', presupuesto: null });
    expect(imp.mapearViaje({ nombre: '  ' }, USER)).toEqual({ ok: false, motivo: 'sin_nombre' });
  });

  test('si el Sheet tiene varios viajes activos queda activo solo el último (la base permite uno)', () => {
    const lista = imp.unSoloViajeActivo([{ idViaje: 'a', estado: 'activo' }, { idViaje: 'b', estado: 'cerrado' }, { idViaje: 'c', estado: 'activo' }]);
    expect(lista.map(v => v.estado)).toEqual(['cerrado', 'cerrado', 'activo']);
  });

  test('presupuestos: monto > 0 obligatorio', () => {
    expect(imp.mapearPresupuesto({ categoria: 'Ropa', montoMensual: 50000 }).presupuesto).toMatchObject({ categoria: 'ropa', montoMensual: 50000 });
    expect(imp.mapearPresupuesto({ categoria: 'ropa', montoMensual: 0 })).toEqual({ ok: false, motivo: 'monto_invalido' });
    expect(imp.mapearPresupuesto({ categoria: '', montoMensual: 5 })).toEqual({ ok: false, motivo: 'sin_categoria' });
  });

  test('preferencias: solo ámbitos válidos', () => {
    expect(imp.mapearPreferencia('Luz', 'personal')).toMatchObject({ ok: true, termino: 'luz' });
    expect(imp.mapearPreferencia('naturgy', 'casa:casa_1_ab')).toMatchObject({ ok: true });
    expect(imp.mapearPreferencia('x', 'otro')).toEqual({ ok: false, motivo: 'ambito_invalido' });
    expect(imp.mapearPreferencia('', 'personal')).toEqual({ ok: false, motivo: 'termino_invalido' });
  });
});

describe('importarPersona', () => {
  const datos = () => ({
    movimientos: [
      mov({ idMov: 'm1' }),
      mov({ idMov: 'm2', descripcion: 'Cine', categoria: 'entretenimiento', monto: 15000, tipo: 'Egreso', viajeId: 'v1' }),
      mov({ idMov: 'm3', monto: 0 }),                           // descartado
      mov({ idMov: 'm4', fecha: 'ayer' }),                      // descartado
      mov({ idMov: 'm5', tipo: 'Ingreso', categoria: 'sueldo', monto: 900000 }),
      mov({ idMov: 'm1' }),                                     // duplicado dentro del Sheet
    ],
    viajes: [
      { idViaje: 'v1', nombre: 'Brasil', fechaInicio: '10/01/2026', fechaFin: '20/01/2026', estado: 'cerrado', presupuesto: 800000, moneda: 'Pesos' },
      { idViaje: 'v2', nombre: 'Madryn', fechaInicio: '01/10/2026', fechaFin: '10/10/2026', estado: 'activo', presupuesto: '', moneda: 'Pesos' },
    ],
    presupuestos: [{ categoria: 'supermercado', montoMensual: 100000, moneda: 'Pesos' }, { categoria: 'ropa', montoMensual: 0 }],
    preferencias: { luz: 'personal', naturgy: 'cualquiera' },
  });

  test('SIMULACRO: calcula el informe y NO escribe nada', async () => {
    const r = await imp.importarPersona({ userId: USER, datos: datos(), repo, aplicar: false });
    expect(r.aplicado).toBe(false);
    expect(r.movimientos).toMatchObject({ leidos: 6, aImportar: 3, yaExistentes: 1, importados: 0 });
    expect(r.movimientos.descartados.map(d => d.motivo).sort()).toEqual(['fecha_ilegible', 'monto_invalido']);
    expect(r.viajes).toMatchObject({ leidos: 2, aImportar: 2, importados: 0 });
    expect(r.presupuestos).toMatchObject({ leidos: 2, aImportar: 1 });
    expect(r.preferencias).toMatchObject({ leidas: 2, aImportar: 1 });
    expect(Object.values(fake.tablas).every(filas => filas.length === 0)).toBe(true); // ninguna fila escrita
  });

  test('APLICAR: escribe a nombre de la persona, con origen "migracion"', async () => {
    const r = await imp.importarPersona({ userId: USER, datos: datos(), repo, aplicar: true });
    expect(r.movimientos.importados).toBe(3);
    expect(r.viajes.importados).toBe(2);

    const filas = fake.tablas.movimientos_personales;
    expect(filas.map(f => f.legacy_id).sort()).toEqual(['m1', 'm2', 'm5']);
    expect(filas.every(f => f.user_id === USER && f.created_by === USER && f.origen_carga === 'migracion')).toBe(true);
    expect(filas.find(f => f.legacy_id === 'm2').viaje_id).toBe('v1'); // el vínculo con el viaje se conserva

    const viajes = fake.tablas.viajes_personales;
    expect(viajes.find(v => v.legacy_id === 'v1').estado).toBe('cerrado');
    expect(viajes.find(v => v.legacy_id === 'v2').estado).toBe('activo');

    expect(await repo.listarPresupuestos(USER)).toEqual([{ categoria: 'supermercado', montoMensual: 100000, moneda: 'Pesos' }]);
    expect(await repo.leerPreferencias(USER)).toEqual({ luz: 'personal' });
  });

  test('IDEMPOTENTE: correrlo dos veces no duplica nada', async () => {
    await imp.importarPersona({ userId: USER, datos: datos(), repo, aplicar: true });
    const segunda = await imp.importarPersona({ userId: USER, datos: datos(), repo, aplicar: true });

    expect(segunda.movimientos).toMatchObject({ aImportar: 0, importados: 0 });
    expect(segunda.movimientos.yaExistentes).toBeGreaterThanOrEqual(3);
    expect(segunda.viajes).toMatchObject({ aImportar: 0, importados: 0, yaExistentes: 2 });
    expect(fake.tablas.movimientos_personales).toHaveLength(3);
    expect(fake.tablas.viajes_personales).toHaveLength(2);
    expect(fake.tablas.presupuestos_personales).toHaveLength(1);
  });

  test('si ya hay un viaje activo en la base, el del Sheet entra como cerrado (la base permite uno solo)', async () => {
    await repo.crearViaje(USER, { idViaje: 'v-ya-activo', nombre: 'Ya abierto' });
    const r = await imp.importarPersona({ userId: USER, datos: { ...datos(), movimientos: [], presupuestos: [], preferencias: {} }, repo, aplicar: true });
    expect(r.viajes.importados).toBe(2);
    expect(fake.tablas.viajes_personales.filter(v => v.estado === 'activo')).toHaveLength(1);
  });

  test('es por persona: importar a una no toca a otra', async () => {
    await imp.importarPersona({ userId: USER, datos: datos(), repo, aplicar: true });
    expect(await repo.listarMovimientos(6666)).toEqual([]);
  });

  test('un informe vacío no falla', async () => {
    const r = await imp.importarPersona({ userId: USER, datos: { movimientos: [], viajes: [], presupuestos: [], preferencias: {} }, repo, aplicar: true });
    expect(r.movimientos.importados).toBe(0);
  });
});

describe('el script', () => {
  test('fuerza PERSONAL_STORE=sheets antes de cargar nada (lee SIEMPRE del Sheet) y es simulacro por defecto', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'importar-personal-a-supabase.js'), 'utf8');
    expect(src.indexOf("process.env.PERSONAL_STORE = 'sheets'")).toBeGreaterThan(-1);
    expect(src.indexOf("process.env.PERSONAL_STORE = 'sheets'")).toBeLessThan(src.indexOf("require('../src/"));
    expect(src).toMatch(/const aplicar = args\.includes\('--aplicar'\)/);
    expect(src).toMatch(/SIMULACRO \(no escribe nada\)/);
  });
});

describe('elegirPersonasAImportar: nunca se le atribuye a una persona el Personal de otra', () => {
  // El caso real de producción: un dueño, un invitado que comparte su sheet, y otro dueño aparte.
  const DUENO = '1419810344';
  const INVITADO = '8321573327';
  const OTRO = '6279333302';
  const duenos = new Set([DUENO, OTRO]);
  const sheets = { [DUENO]: 'sheetA', [INVITADO]: 'sheetA', [OTRO]: 'sheetB' };
  const elegir = (ids) => imp.elegirPersonasAImportar(ids, (id) => duenos.has(id), (id) => sheets[id] || null);

  test('el invitado que comparte el sheet del dueño se OMITE (leerlo daría el Personal del dueño)', () => {
    const r = elegir([DUENO, INVITADO, OTRO]);
    expect(r.importar.map(p => p.userId)).toEqual([DUENO, OTRO]);
    expect(r.omitidos).toEqual([{ userId: INVITADO, motivo: expect.stringMatching(/agregado/) }]);
  });

  test('aunque el invitado figure PRIMERO, no gana el sheet', () => {
    const r = elegir([INVITADO, DUENO]);
    expect(r.importar).toEqual([{ userId: DUENO, sheetId: 'sheetA' }]);
  });

  test('dos dueños con el MISMO sheet: se procesa una sola vez, a nombre del primero', () => {
    const r = imp.elegirPersonasAImportar(['1', '2'], () => true, () => 'mismoSheet');
    expect(r.importar).toEqual([{ userId: '1', sheetId: 'mismoSheet' }]);
    expect(r.omitidos[0].motivo).toMatch(/comparte el sheet de 1/);
  });

  test('un dueño sin sheet se omite', () => {
    const r = imp.elegirPersonasAImportar(['9'], () => true, () => null);
    expect(r.importar).toEqual([]);
    expect(r.omitidos[0].motivo).toBe('sin sheet');
  });

  test('el script usa esta selección (no recorre los perfiles a ciegas)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'importar-personal-a-supabase.js'), 'utf8');
    expect(src).toMatch(/elegirPersonasAImportar\(/);
    expect(src).toMatch(/\(omitido\)/);
  });
});
