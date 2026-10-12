// Editar un movimiento CON Supabase: todos los campos llegan a la base (y al Sheet de respaldo), con el
// tipo en minúscula, las fechas como DATE, y respetando qué columnas existen en esa base.

let mockFila;
let mockUpdates;
let mockCapabilities;

jest.mock('../src/config', () => ({ ...jest.requireActual('../src/config'), USE_SUPABASE: true }));
jest.mock('../src/lib/supabase', () => {
  // Sondas de columnas: el error "column does not exist" apaga esa capacidad.
  const sonda = (cols) => ({
    select: (columnas) => ({
      limit: async () => {
        const falta = (columnas.includes('categoria') && !mockCapabilities.extendedMovimientos)
          || (columnas.includes('paciente') && !mockCapabilities.extendedCampos)
          || (columnas.includes('fecha_cobro') && !mockCapabilities.fechaCobro)
          || (columnas.includes('fecha_iso') && !mockCapabilities.fechaIso);
        return falta ? { error: { message: 'column movimientos.x does not exist' } } : { error: null, data: [] };
      },
    }),
  });
  // movimientos_v2 no está desplegada en producción: la sonda de relación falla como en la base real.
  const sinV2 = { select: () => ({ limit: async () => ({ error: { message: 'relation "movimientos_v2" does not exist' } }) }) };
  return { isAvailable: () => true, getSupabase: () => ({ from: (t) => (String(t).startsWith('movimiento') && String(t).endsWith('_v2') ? sinV2 : sonda(t)) }) };
});
jest.mock('../src/lib/tenant-db', () => ({
  SCOPED_TABLES: new Set(['movimientos']),
  forTenant: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ limit: async () => ({ data: [mockFila], error: null }) }) }),
      update: (patch) => ({ eq: async () => { mockUpdates.push(patch); return { error: null }; } }),
    }),
  }),
}));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn().mockResolvedValue('t1'), invalidateTenantCache: jest.fn() }));
const mockSheetRow = { data: {}, get(c) { return this.data[c]; }, set(c, v) { this.data[c] = v; }, save: jest.fn(async () => {}) };
jest.mock('../src/services/sheet.service', () => ({
  getSheetCliente: jest.fn(async () => ({ getRows: async () => [mockSheetRow] })),
  ensureSheetStructure: jest.fn(),
  invalidateCache: jest.fn(),
}));

const db = require('../src/services/db.service');

const filaBase = () => ({
  id: 7, id_unico: 'u1', fecha: '2026-10-05', hora: '10:00', descripcion: 'Consulta', monto: 500, estado: 'Cobrado',
  tipo: 'ingreso', moneda: 'Pesos', metodo_pago: 'efectivo', monto_pesos: 500, id_origen: 'a@b.com',
});

const esperarBackground = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  mockFila = filaBase();
  mockUpdates = [];
  mockSheetRow.data = { ID_Unico: 'u1', Tipo: 'Ingreso', Monto: 500, Estado: 'Cobrado' };
  mockSheetRow.save.mockClear();
  mockCapabilities = { extendedMovimientos: true, extendedCampos: true, fechaCobro: true, fechaIso: true };
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// La caché de capacidades es del módulo: se resetea con un módulo nuevo para cada escenario de columnas.
function conModuloNuevo(fn) {
  return async () => {
    let dbNuevo;
    jest.isolateModules(() => { dbNuevo = require('../src/services/db.service'); });
    await fn(dbNuevo);
  };
}

test('guarda cada campo en su columna, con el formato que usa la base', conModuloNuevo(async (d) => {
  await d.updateMovimiento(1, 'u1', {
    categoria: 'honorarios', paciente: 'Ana', profesional: 'Laura', tratamiento: 'Ortodoncia', proveedor: '',
    fecha: '07/10/2026', fechaPrestacion: '06/10/2026', fechaVencimiento: '07/11/2026',
  });
  expect(mockUpdates).toHaveLength(1);
  expect(mockUpdates[0]).toMatchObject({
    categoria: 'honorarios', paciente: 'Ana', profesional: 'Laura', tratamiento: 'Ortodoncia',
    fecha: '2026-10-07', fecha_prestacion: '2026-10-06', fecha_vencimiento: '2026-11-07',
  });
  expect(mockUpdates[0].proveedor).toBeNull(); // vaciado = null
}));

test('cambiar el tipo: la base lo guarda en minúscula y da vuelta el signo del monto', conModuloNuevo(async (d) => {
  await d.updateMovimiento(1, 'u1', { tipo: 'Egreso' });
  expect(mockUpdates[0]).toMatchObject({ tipo: 'egreso', monto: -500, monto_pesos: -500 });
}));

test('un egreso editado conserva el signo negativo', conModuloNuevo(async (d) => {
  mockFila = { ...filaBase(), tipo: 'egreso', monto: -500, monto_pesos: -500 };
  await d.updateMovimiento(1, 'u1', { monto: 900 });
  expect(mockUpdates[0]).toMatchObject({ monto: -900, monto_pesos: -900 });
}));

test('la copia en el Sheet recibe lo mismo: tipo "Egreso", fechas DD/MM/AAAA, textos vaciados como celda vacía', conModuloNuevo(async (d) => {
  await d.updateMovimiento(1, 'u1', { tipo: 'Egreso', fecha: '07/10/2026', proveedor: '', paciente: 'Ana' });
  await esperarBackground();
  expect(mockSheetRow.data).toMatchObject({ Tipo: 'Egreso', Fecha: '07/10/2026', Proveedor: '', Paciente: 'Ana', Monto: -500 });
  expect(mockSheetRow.save).toHaveBeenCalled();
}));

test('una fecha del movimiento vacía o inválida no se manda (no puede quedar sin fecha)', conModuloNuevo(async (d) => {
  await d.updateMovimiento(1, 'u1', { fecha: '', descripcion: 'x' });
  expect(mockUpdates[0]).not.toHaveProperty('fecha');
  expect(mockUpdates[0].descripcion).toBe('x');
}));

test('sin las columnas extendidas (migración sin correr) esos campos se omiten en vez de romper la edición', conModuloNuevo(async (d) => {
  mockCapabilities = { extendedMovimientos: false, extendedCampos: false, fechaCobro: true, fechaIso: true };
  await d.updateMovimiento(1, 'u1', { categoria: 'honorarios', paciente: 'Ana', fechaVencimiento: '07/11/2026', descripcion: 'x' });
  expect(mockUpdates[0]).toEqual({ descripcion: 'x' });
}));

test('con las columnas de campos pero sin la de categoría: se guardan unas y se omite la otra', conModuloNuevo(async (d) => {
  mockCapabilities = { extendedMovimientos: false, extendedCampos: true, fechaCobro: true, fechaIso: true };
  await d.updateMovimiento(1, 'u1', { categoria: 'honorarios', paciente: 'Ana' });
  expect(mockUpdates[0]).toEqual({ paciente: 'Ana' });
}));
