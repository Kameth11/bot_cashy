// casa.service con un spreadsheet falso en memoria: pestañas por (dueño, título),
// mockPerfiles y autenticación simulados.

const mockStore = {};      // `${ownerId}|${title}` -> MockTab
const mockPerfiles = {};   // userId -> [{casaId, ownerId, nombre}] ; ausente = sin perfil propio
const mockCuentas = {};    // userId -> { isOwner, ownerId }

class MockRow {
  constructor(tab, data) { this.tab = tab; this.data = { ...data }; }
  get(k) { return this.data[k]; }
  set(k, v) { this.data[k] = v; }
  async save() {}
  async delete() { this.tab.rows = this.tab.rows.filter((r) => r !== this); }
}
class MockTab {
  constructor() { this.rows = []; }
  async addRow(obj) { const r = new MockRow(this, obj); this.rows.push(r); return r; }
  async getRows() { return [...this.rows]; }
}

jest.mock('../src/services/sheet-tab.service', () => ({
  getOrCreateTabConReintento: async (ownerId, title) => {
    const key = `${ownerId}|${title}`;
    if (!mockStore[key]) mockStore[key] = new MockTab();
    return mockStore[key];
  },
}));
jest.mock('../src/auth', () => ({ obtenerClientePorUserId: (id) => mockCuentas[String(id)] || null }));
jest.mock('../src/services/cliente.service', () => ({
  getCasas: (id) => (mockPerfiles[String(id)] ? mockPerfiles[String(id)].map((c) => ({ ...c })) : null),
  setCasas: async (id, casas) => { if (!mockPerfiles[String(id)]) return false; mockPerfiles[String(id)] = casas.map((c) => ({ ...c })); return true; },
}));
jest.mock('../src/services/movimiento.service', () => ({ convertirAPesos: (m, mon) => (mon === 'Pesos' ? m : m * 1000) }));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const svc = require('../src/services/casa.service');

const filas = (owner, title) => (mockStore[`${owner}|${title}`] ? mockStore[`${owner}|${title}`].rows.map((r) => r.data) : []);
const code = async (p) => { try { await p; return null; } catch (e) { return e.code || e.message; } };

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  for (const k of Object.keys(mockPerfiles)) delete mockPerfiles[k];
  for (const k of Object.keys(mockCuentas)) delete mockCuentas[k];
  // 1 y 2: mockCuentas propias; 3: invitado de otro consultorio (sin perfil propio)
  mockCuentas['1'] = { isOwner: true, ownerId: '1' };
  mockCuentas['2'] = { isOwner: true, ownerId: '2' };
  mockCuentas['3'] = { isOwner: false, ownerId: '1' };
  mockPerfiles['1'] = [];
  mockPerfiles['2'] = [];
});

async function casaConDos() {
  const c = await svc.crearCasa(1, 'Casa', { alias: 'Ana' });
  await svc.unirMiembro(2, { ownerId: c.ownerId, casaId: c.casaId, alias: 'Beto' });
  return c;
}
const idMiembro = async (userId, casaId, nombre) => (await svc.listarMiembros(userId, casaId)).find((m) => m.nombre === nombre).id;

describe('crearCasa', () => {
  test('crea la casa y al creador como miembro, en el sheet del creador, y la indexa en su perfil', async () => {
    const c = await svc.crearCasa(1, 'Casa Dinamarca', { alias: 'Ana' });
    expect(filas('1', 'Casas')).toHaveLength(1);
    expect(filas('1', 'Casas')[0]).toMatchObject({ ID_Casa: c.casaId, Nombre: 'Casa Dinamarca', CreadaPor: '1', Estado: 'activa' });
    expect(filas('1', 'CasaMiembros')[0]).toMatchObject({ Rol: 'creador', UserId: '1', Nombre: 'Ana', Estado: 'activo' });
    expect(mockPerfiles['1']).toEqual([{ casaId: c.casaId, ownerId: '1', nombre: 'Casa Dinamarca', activa: true }]);
  });

  test('puede tener varias casas, pero no dos con el mismo nombre (sin importar tildes ni mayúsculas)', async () => {
    await svc.crearCasa(1, 'Casa');
    await svc.crearCasa(1, 'Casa Dinamarca');
    expect(svc.listarMisCasas(1)).toHaveLength(2);
    expect(await code(svc.crearCasa(1, 'CÁSA'))).toBe('nombre_repetido');
  });

  test('un invitado sin cuenta propia no puede crear casas', async () => {
    expect(await code(svc.crearCasa(3, 'Casa'))).toBe('solo_duenos');
    expect(await code(svc.crearCasa(99, 'Casa'))).toBe('solo_duenos');
  });

  test('cuenta sin perfil propio → sin_cuenta', async () => {
    mockCuentas['4'] = { isOwner: true, ownerId: '4' };
    expect(await code(svc.crearCasa(4, 'Casa'))).toBe('sin_cuenta');
  });

  test('valida el nombre', async () => {
    expect(await code(svc.crearCasa(1, 'a'))).toBe('nombre_invalido');
    expect(await code(svc.crearCasa(1, 'x'.repeat(41)))).toBe('nombre_invalido');
    expect(filas('1', 'Casas')).toHaveLength(0);
  });
});

describe('obtenerCasaParaMiembro (control de acceso)', () => {
  test('un miembro accede', async () => {
    const c = await casaConDos();
    const ctx = await svc.obtenerCasaParaMiembro(2, c.casaId);
    expect(ctx.yo.nombre).toBe('Beto');
    expect(ctx.esCreador).toBe(false);
    expect(ctx.ownerId).toBe('1');
  });

  test('quien no tiene la casa en su perfil no accede', async () => {
    const c = await svc.crearCasa(1, 'Casa');
    expect(await code(svc.obtenerCasaParaMiembro(2, c.casaId))).toBe('no_miembro');
  });

  test('un invitado del consultorio (sin perfil) no accede', async () => {
    const c = await svc.crearCasa(1, 'Casa');
    expect(await code(svc.obtenerCasaParaMiembro(3, c.casaId))).toBe('no_miembro');
  });

  test('un índice forjado en el perfil no alcanza: se verifica contra el sheet', async () => {
    const c = await svc.crearCasa(1, 'Casa');
    mockPerfiles['2'] = [{ casaId: c.casaId, ownerId: '1', nombre: 'Casa' }]; // no figura en CasaMiembros
    expect(await code(svc.obtenerCasaParaMiembro(2, c.casaId))).toBe('no_miembro');
  });

  test('el ownerId sale del perfil: apuntar a otro dueño no da acceso a casas ajenas', async () => {
    const c = await svc.crearCasa(1, 'Casa');
    mockPerfiles['2'] = [{ casaId: c.casaId, ownerId: '2', nombre: 'Casa' }]; // busca en el sheet de 2, donde no existe
    expect(await code(svc.obtenerCasaParaMiembro(2, c.casaId))).toBe('casa_inexistente');
  });

  test('un miembro dado de baja pierde el acceso aunque su perfil no se haya limpiado', async () => {
    const c = await casaConDos();
    mockStore['1|CasaMiembros'].rows.find((r) => r.get('UserId') === '2').set('Estado', 'baja');
    expect(await code(svc.obtenerCasaParaMiembro(2, c.casaId))).toBe('no_miembro');
  });

  test('una casa no se ve desde otra casa del mismo usuario', async () => {
    const a = await svc.crearCasa(1, 'Casa A');
    const b = await svc.crearCasa(1, 'Casa B');
    await svc.registrarGasto(1, a.casaId, { descripcion: 'luz', monto: 100 });
    expect(await svc.listarMovimientos(1, b.casaId)).toHaveLength(0);
    expect(await svc.listarMovimientos(1, a.casaId)).toHaveLength(1);
  });
});

describe('miembros', () => {
  test('agregar un miembro virtual (sin Telegram)', async () => {
    const c = await svc.crearCasa(1, 'Casa', { alias: 'Ana' });
    const m = await svc.agregarMiembroVirtual(1, c.casaId, 'Hijo Tomás');
    expect(m.userId).toBe('');
    expect((await svc.listarMiembros(1, c.casaId)).map((x) => x.nombre)).toEqual(['Ana', 'Hijo Tomás']);
  });

  test('no permite nombres repetidos ni agregar sin ser miembro', async () => {
    const c = await svc.crearCasa(1, 'Casa', { alias: 'Ana' });
    expect(await code(svc.agregarMiembroVirtual(1, c.casaId, 'ANA'))).toBe('nombre_repetido');
    expect(await code(svc.agregarMiembroVirtual(2, c.casaId, 'Otro'))).toBe('no_miembro');
  });

  test('unirse con alias: queda en el índice del perfil', async () => {
    const c = await svc.crearCasa(1, 'Casa', { alias: 'Ana' });
    const r = await svc.unirMiembro(2, { ownerId: '1', casaId: c.casaId, alias: 'Beto' });
    expect(r.miembro.nombre).toBe('Beto');
    expect(mockPerfiles['2']).toEqual([{ casaId: c.casaId, ownerId: '1', nombre: 'Casa', activa: true }]);
  });

  test('reclamar un miembro virtual conserva su historial', async () => {
    const c = await svc.crearCasa(1, 'Casa', { alias: 'Ana' });
    const virtual = await svc.agregarMiembroVirtual(1, c.casaId, 'Beto');
    await svc.registrarGasto(1, c.casaId, { descripcion: 'súper', monto: 1000 });
    await svc.unirMiembro(2, { ownerId: '1', casaId: c.casaId, miembroId: virtual.id });
    const saldos = await svc.calcularSaldosCasa(2, c.casaId);
    expect(saldos.saldos.Pesos.saldos.find((s) => s.nombre === 'Beto').saldo).toBe(-500 + 0); // pagó Ana, repartido entre Ana y Beto(virtual)
  });

  test('no se puede reclamar un miembro ya reclamado, ni unirse dos veces, ni a una casa inexistente', async () => {
    const c = await casaConDos();
    const beto = await idMiembro(1, c.casaId, 'Beto');
    mockCuentas['5'] = { isOwner: true, ownerId: '5' }; mockPerfiles['5'] = [];
    expect(await code(svc.unirMiembro(5, { ownerId: '1', casaId: c.casaId, miembroId: beto }))).toBe('miembro_no_disponible');
    expect(await code(svc.unirMiembro(2, { ownerId: '1', casaId: c.casaId, alias: 'Otra vez' }))).toBe('ya_miembro');
    expect(await code(svc.unirMiembro(5, { ownerId: '1', casaId: 'casa_x', alias: 'Eva' }))).toBe('casa_inexistente');
  });

  test('un invitado sin cuenta propia no puede unirse', async () => {
    const c = await svc.crearCasa(1, 'Casa');
    expect(await code(svc.unirMiembro(3, { ownerId: '1', casaId: c.casaId, alias: 'Invitado' }))).toBe('solo_duenos');
  });

  test('alias repetido al unirse → nombre_repetido', async () => {
    const c = await svc.crearCasa(1, 'Casa', { alias: 'Ana' });
    expect(await code(svc.unirMiembro(2, { ownerId: '1', casaId: c.casaId, alias: 'ana' }))).toBe('nombre_repetido');
  });
});

describe('registrarGasto', () => {
  test('por defecto paga quien lo carga y se reparte entre todos los activos (ids explícitos)', async () => {
    const c = await casaConDos();
    const { movimiento } = await svc.registrarGasto(2, c.casaId, { descripcion: 'Súper', monto: '30000', moneda: 'Pesos', categoria: 'supermercado' });
    const beto = await idMiembro(2, c.casaId, 'Beto');
    const ana = await idMiembro(2, c.casaId, 'Ana');
    expect(movimiento.pagoPor).toBe(beto);
    expect(movimiento.repartoEntre.sort()).toEqual([ana, beto].sort());
    expect(filas('1', 'CasaMovimientos')[0]).toMatchObject({ ID_Casa: c.casaId, Tipo: 'gasto', Monto: 30000, ID_Origen: '2', Categoria: 'supermercado' });
  });

  test('convierte a pesos para el resumen', async () => {
    const c = await svc.crearCasa(1, 'Casa Dinamarca');
    const { movimiento } = await svc.registrarGasto(1, c.casaId, { descripcion: 'Alquiler', monto: 50, moneda: 'Euros' });
    expect(movimiento.montoPesos).toBe(50000);
  });

  test('pagador y reparto personalizados', async () => {
    const c = await casaConDos();
    const ana = await idMiembro(1, c.casaId, 'Ana');
    const beto = await idMiembro(1, c.casaId, 'Beto');
    const { movimiento } = await svc.registrarGasto(1, c.casaId, { descripcion: 'Cena', monto: 900, pagoPor: beto, repartoEntre: [ana] });
    expect(movimiento.pagoPor).toBe(beto);
    expect(movimiento.repartoEntre).toEqual([ana]);
  });

  test('rechaza miembros que no son de la casa (incluso de otra casa)', async () => {
    const c = await casaConDos();
    const otra = await svc.crearCasa(1, 'Otra', { alias: 'Ana' });
    const ajeno = (await svc.listarMiembros(1, otra.casaId))[0].id;
    expect(await code(svc.registrarGasto(1, c.casaId, { descripcion: 'x1', monto: 10, pagoPor: ajeno }))).toBe('pagador_invalido');
    expect(await code(svc.registrarGasto(1, c.casaId, { descripcion: 'x1', monto: 10, repartoEntre: [ajeno] }))).toBe('reparto_invalido');
  });

  test('valida monto, moneda y descripción', async () => {
    const c = await svc.crearCasa(1, 'Casa');
    expect(await code(svc.registrarGasto(1, c.casaId, { descripcion: 'luz', monto: 0 }))).toBe('monto_invalido');
    expect(await code(svc.registrarGasto(1, c.casaId, { descripcion: 'luz', monto: 'abc' }))).toBe('monto_invalido');
    expect(await code(svc.registrarGasto(1, c.casaId, { descripcion: 'luz', monto: 5, moneda: 'DKK' }))).toBe('moneda_invalida');
    expect(await code(svc.registrarGasto(1, c.casaId, { descripcion: ' ', monto: 5 }))).toBe('descripcion_invalida');
    expect(filas('1', 'CasaMovimientos')).toHaveLength(0);
  });

  test('no miembro no puede cargar gastos', async () => {
    const c = await svc.crearCasa(1, 'Casa');
    expect(await code(svc.registrarGasto(2, c.casaId, { descripcion: 'luz', monto: 5 }))).toBe('no_miembro');
  });

  test('escrituras simultáneas de miembros de mockCuentas distintas se guardan todas', async () => {
    const c = await casaConDos();
    await Promise.all([
      svc.registrarGasto(1, c.casaId, { descripcion: 'uno', monto: 1 }),
      svc.registrarGasto(2, c.casaId, { descripcion: 'dos', monto: 2 }),
      svc.registrarGasto(1, c.casaId, { descripcion: 'tres', monto: 3 }),
      svc.registrarGasto(2, c.casaId, { descripcion: 'cuatro', monto: 4 }),
    ]);
    expect(filas('1', 'CasaMovimientos')).toHaveLength(4);
  });

  test('quien se une después no hereda gastos anteriores', async () => {
    const c = await svc.crearCasa(1, 'Casa', { alias: 'Ana' });
    await svc.registrarGasto(1, c.casaId, { descripcion: 'viejo', monto: 1000 });
    await svc.unirMiembro(2, { ownerId: '1', casaId: c.casaId, alias: 'Beto' });
    const s = await svc.calcularSaldosCasa(1, c.casaId);
    expect(s.saldos.Pesos.saldos.find((x) => x.nombre === 'Beto').saldo).toBe(0);
    expect(s.saldos.Pesos.transferencias).toEqual([]);
  });
});

describe('liquidaciones y saldos', () => {
  test('gasto + liquidación parcial deja el resto pendiente, con nombres', async () => {
    const c = await casaConDos();
    await svc.registrarGasto(1, c.casaId, { descripcion: 'Alquiler', monto: 1000 }); // paga Ana, 50/50
    const ana = await idMiembro(1, c.casaId, 'Ana');
    await svc.registrarLiquidacion(2, c.casaId, { para: ana, monto: 200 }); // Beto le paga 200
    const s = await svc.calcularSaldosCasa(1, c.casaId);
    expect(s.saldos.Pesos.transferencias).toEqual([{ de: expect.any(String), para: ana, monto: 300, deNombre: 'Beto', paraNombre: 'Ana' }]);
  });

  test('validaciones de liquidación', async () => {
    const c = await casaConDos();
    const ana = await idMiembro(1, c.casaId, 'Ana');
    expect(await code(svc.registrarLiquidacion(1, c.casaId, { para: ana, monto: 10 }))).toBe('liquidacion_invalida');
    expect(await code(svc.registrarLiquidacion(1, c.casaId, { para: 'nadie', monto: 10 }))).toBe('destinatario_invalido');
    expect(await code(svc.registrarLiquidacion(2, c.casaId, { para: ana, monto: 0 }))).toBe('monto_invalido');
  });
});

describe('eliminarMovimiento', () => {
  test('el creador borra los de otros; un miembro solo los suyos', async () => {
    const c = await casaConDos();
    const deAna = (await svc.registrarGasto(1, c.casaId, { descripcion: 'de Ana', monto: 10 })).movimiento.idMov;
    const deBeto = (await svc.registrarGasto(2, c.casaId, { descripcion: 'de Beto', monto: 10 })).movimiento.idMov;
    expect(await code(svc.eliminarMovimiento(2, c.casaId, deAna))).toBe('sin_permiso');
    expect(await svc.eliminarMovimiento(2, c.casaId, deBeto)).toBe(true);
    expect(await svc.eliminarMovimiento(1, c.casaId, deAna)).toBe(true);
    expect(filas('1', 'CasaMovimientos')).toHaveLength(0);
  });

  test('id inexistente → false; un id de otra casa no se puede borrar', async () => {
    const a = await svc.crearCasa(1, 'Casa A');
    const b = await svc.crearCasa(1, 'Casa B');
    const idB = (await svc.registrarGasto(1, b.casaId, { descripcion: 'en B', monto: 5 })).movimiento.idMov;
    expect(await svc.eliminarMovimiento(1, a.casaId, 'nada')).toBe(false);
    expect(await svc.eliminarMovimiento(1, a.casaId, idB)).toBe(false);
    expect(filas('1', 'CasaMovimientos')).toHaveLength(1);
  });
});

describe('quitarMiembro', () => {
  test('solo el creador quita a otros; no se puede quitar al creador', async () => {
    const c = await casaConDos();
    const ana = await idMiembro(1, c.casaId, 'Ana');
    const beto = await idMiembro(1, c.casaId, 'Beto');
    expect(await code(svc.quitarMiembro(2, c.casaId, ana))).toBe('solo_creador'); // Beto intenta quitar a Ana
    expect(await code(svc.quitarMiembro(1, c.casaId, ana))).toBe('no_se_puede_quitar_creador');
    expect(await svc.quitarMiembro(1, c.casaId, beto)).toBe(true);
  });

  test('tras la baja pierde el acceso y se limpia su perfil; su historial queda', async () => {
    const c = await casaConDos();
    const beto = await idMiembro(1, c.casaId, 'Beto');
    await svc.quitarMiembro(1, c.casaId, beto);
    expect(mockPerfiles['2']).toEqual([]);
    expect(await code(svc.obtenerCasaParaMiembro(2, c.casaId))).toBe('no_miembro');
    expect(filas('1', 'CasaMiembros').find((m) => m.Nombre === 'Beto').Estado).toBe('baja');
  });

  test('con saldo pendiente no se puede quitar', async () => {
    const c = await casaConDos();
    await svc.registrarGasto(1, c.casaId, { descripcion: 'luz', monto: 1000 });
    const beto = await idMiembro(1, c.casaId, 'Beto');
    expect(await code(svc.quitarMiembro(1, c.casaId, beto))).toBe('saldo_pendiente');
  });

  test('un miembro puede salirse solo (si está saldado)', async () => {
    const c = await casaConDos();
    const beto = await idMiembro(2, c.casaId, 'Beto');
    expect(await svc.quitarMiembro(2, c.casaId, beto)).toBe(true);
    expect(await code(svc.listarMovimientos(2, c.casaId))).toBe('no_miembro');
  });

  test('un miembro dado de baja no figura para repartir gastos nuevos', async () => {
    const c = await casaConDos();
    const beto = await idMiembro(1, c.casaId, 'Beto');
    await svc.quitarMiembro(1, c.casaId, beto);
    const { movimiento } = await svc.registrarGasto(1, c.casaId, { descripcion: 'luz', monto: 100 });
    expect(movimiento.repartoEntre).toEqual([await idMiembro(1, c.casaId, 'Ana')]);
    expect(await code(svc.registrarGasto(1, c.casaId, { descripcion: 'luz', monto: 100, pagoPor: beto }))).toBe('pagador_invalido');
  });
});

describe('calcularResumenCasa', () => {
  test('totales del mes por moneda y categoría, y saldos con nombres', async () => {
    const c = await casaConDos();
    await svc.registrarGasto(1, c.casaId, { descripcion: 'Súper', monto: 1000, categoria: 'supermercado', fecha: '05/03/2026' });
    await svc.registrarGasto(2, c.casaId, { descripcion: 'Luz', monto: 400, categoria: 'servicios', fecha: '06/03/2026' });
    await svc.registrarGasto(1, c.casaId, { descripcion: 'Viejo', monto: 999, categoria: 'otros', fecha: '05/02/2026' });
    const r = await svc.calcularResumenCasa(1, c.casaId, '2026-03');
    expect(r.cantidad).toBe(2);
    expect(r.gastosPorMoneda).toEqual({ Pesos: 1400 });
    expect(r.porCategoria).toEqual({ supermercado: 1000, servicios: 400 });
    expect(r.miembros.map((m) => m.nombre).sort()).toEqual(['Ana', 'Beto']);
    expect(r.esCreador).toBe(true);
    // saldos de toda la historia, no del mes: Ana puso 1999, Beto 400, total 2399 → 1199.5 c/u
    expect(r.saldos.Pesos.saldos.find((s) => s.nombre === 'Ana').saldo).toBe(799.5);
  });

  test('un no miembro no puede ver el resumen', async () => {
    const c = await svc.crearCasa(1, 'Casa');
    expect(await code(svc.calcularResumenCasa(2, c.casaId))).toBe('no_miembro');
  });
});

describe('casa activa', () => {
  test('la última creada o a la que te uniste queda activa', async () => {
    const a = await svc.crearCasa(1, 'Casa A');
    expect(svc.getCasaActiva(1).casaId).toBe(a.casaId);
    const b = await svc.crearCasa(1, 'Casa B');
    expect(svc.getCasaActiva(1).casaId).toBe(b.casaId);
    expect(svc.listarMisCasas(1).filter((c) => c.activa)).toHaveLength(1);
  });

  test('setCasaActiva cambia la marca y rechaza casas ajenas', async () => {
    const a = await svc.crearCasa(1, 'Casa A');
    await svc.crearCasa(1, 'Casa B');
    await svc.setCasaActiva(1, a.casaId);
    expect(svc.getCasaActiva(1).casaId).toBe(a.casaId);
    expect(await code(svc.setCasaActiva(2, a.casaId))).toBe('no_miembro');
  });

  test('sin casas: null; sin marca: la primera', async () => {
    expect(svc.getCasaActiva(1)).toBeNull();
    mockPerfiles['1'] = [{ casaId: 'x1', ownerId: '1', nombre: 'Una' }, { casaId: 'x2', ownerId: '1', nombre: 'Dos' }];
    expect(svc.getCasaActiva(1).casaId).toBe('x1');
  });
});
