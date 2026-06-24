// Guarda de escalabilidad: la lectura de movimientos debe estar ACOTADA. Sin
// el .limit(), un tenant con años de historia traería decenas de miles de
// filas en cada fetch del dashboard. Si alguien borra el limit o el order,
// este test lo detecta.

const calls = [];
const builder = {
  select: (...a) => { calls.push(['select', ...a]); return builder; },
  eq: (...a) => { calls.push(['eq', ...a]); return builder; },
  order: (...a) => { calls.push(['order', ...a]); return builder; },
  limit: (...a) => { calls.push(['limit', ...a]); return Promise.resolve({ data: [], error: null }); },
};

jest.mock('../src/lib/tenant-db', () => ({
  SCOPED_TABLES: new Set(['movimientos', 'profesionales']),
  forTenant: jest.fn(() => ({ from: () => builder })),
}));

const { fetchLegacyRowsForUser, MAX_MOVIMIENTOS_READ } = require('../src/services/db.service');
const { forTenant } = require('../src/lib/tenant-db');

describe('db.service lectura acotada (guarda de escalabilidad)', () => {
  beforeEach(() => { calls.length = 0; });

  test('MAX_MOVIMIENTOS_READ tiene un valor finito razonable', () => {
    expect(typeof MAX_MOVIMIENTOS_READ).toBe('number');
    expect(MAX_MOVIMIENTOS_READ).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_MOVIMIENTOS_READ)).toBe(true);
  });

  test('fetchLegacyRowsForUser arma la query con order desc + limit acotado', async () => {
    await fetchLegacyRowsForUser({}, 123, 'tenant-1');

    // La query pasa por la barrera de tenant.
    expect(forTenant).toHaveBeenCalledWith('tenant-1');
    // Filtra por usuario.
    expect(calls).toContainEqual(['eq', 'user_id', 123]);
    // Trae las más recientes primero...
    expect(calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    // ...y SIEMPRE acota la cantidad.
    expect(calls).toContainEqual(['limit', MAX_MOVIMIENTOS_READ]);
  });

  test('el limit es el último eslabón de la cadena (no se puede omitir)', async () => {
    await fetchLegacyRowsForUser({}, 1, 'tenant-1');
    const limitCall = calls.find(c => c[0] === 'limit');
    expect(limitCall).toBeDefined();
    expect(limitCall[1]).toBe(MAX_MOVIMIENTOS_READ);
  });
});
