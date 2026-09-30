// Cache corto + single-flight de obtenerDatosSheet con Supabase: lecturas
// simultáneas comparten UNA consulta, y una escritura invalida la cache.

const mockRowsFor = jest.fn();
jest.mock('../src/config', () => ({ ...jest.requireActual('../src/config'), USE_SUPABASE: true }));
// Las tablas v2 no existen (igual que en producción hoy): capability = false.
jest.mock('../src/lib/supabase', () => ({
  isAvailable: () => true,
  getSupabase: () => ({
    from: () => ({ select: () => ({ limit: () => Promise.resolve({ error: { message: 'relation "x" does not exist' } }) }) }),
  }),
}));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn().mockResolvedValue('t1'), invalidateTenantCache: jest.fn() }));
jest.mock('../src/lib/tenant-db', () => ({
  SCOPED_TABLES: new Set(['movimientos']),
  forTenant: () => ({
    from: () => {
      const b = {
        select: () => b, order: () => b,
        range: () => { mockRowsFor(); return Promise.resolve({ data: [], error: null }); },
      };
      return b;
    },
  }),
}));

const db = require('../src/services/db.service');
const events = require('../src/services/events.service');

describe('obtenerDatosSheet cache', () => {
  beforeEach(() => { mockRowsFor.mockClear(); db.invalidateCache(1); });

  test('lecturas simultáneas comparten una sola consulta', async () => {
    await Promise.all([db.obtenerDatosSheet(1), db.obtenerDatosSheet(1), db.obtenerDatosSheet(1)]);
    expect(mockRowsFor).toHaveBeenCalledTimes(1);
  });

  test('una lectura posterior dentro del TTL usa la cache', async () => {
    await db.obtenerDatosSheet(1);
    await db.obtenerDatosSheet(1);
    expect(mockRowsFor).toHaveBeenCalledTimes(1);
  });

  test('una escritura (evento de movimientos) invalida la cache', async () => {
    await db.obtenerDatosSheet(1);
    events.emitMovimientosUpdated(1);
    await db.obtenerDatosSheet(1);
    expect(mockRowsFor).toHaveBeenCalledTimes(2);
  });
});
