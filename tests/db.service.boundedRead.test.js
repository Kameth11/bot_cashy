// Guarda de escalabilidad: la lectura de movimientos debe estar ACOTADA. Sin
// el .limit(), un tenant con años de historia traería decenas de miles de
// filas en cada fetch del dashboard. Si alguien borra el limit o el order,
// este test lo detecta.

const calls = [];
// Simula un servidor con max-rows=1000: cada página devuelve como mucho 1000
// filas de una tabla de `tablaSize` filas.
let tablaSize = 0;
const builder = {
  select: (...a) => { calls.push(['select', ...a]); return builder; },
  eq: (...a) => { calls.push(['eq', ...a]); return builder; },
  order: (...a) => { calls.push(['order', ...a]); return builder; },
  range: (from, to) => {
    calls.push(['range', from, to]);
    const n = Math.max(0, Math.min(to, tablaSize - 1) - from + 1);
    return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ id: from + i })), error: null });
  },
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

  test('fetchLegacyRowsForUser arma la query con order desc estable + páginas acotadas', async () => {
    tablaSize = 10;
    await fetchLegacyRowsForUser({}, 123, 'tenant-1');

    // La query pasa por la barrera de tenant — ESE es el límite de
    // aislamiento correcto (dueño + invitados comparten un consultorio).
    expect(forTenant).toHaveBeenCalledWith('tenant-1');
    // NO filtra además por user_id: eso hacía que cada invitado solo viera
    // lo que él mismo había cargado, no el balance real del consultorio.
    expect(calls.find(c => c[0] === 'eq' && c[1] === 'user_id')).toBeUndefined();
    expect(calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(calls).toContainEqual(['order', 'id', { ascending: false }]);
    expect(calls).toContainEqual(['range', 0, 999]);
  });

  test('trae TODAS las filas aunque el servidor corte cada respuesta en 1000', async () => {
    tablaSize = 2500;
    const rows = await fetchLegacyRowsForUser({}, 1, 'tenant-1');
    expect(rows).toHaveLength(2500);
    expect(calls.filter(c => c[0] === 'range')).toEqual([['range', 0, 999], ['range', 1000, 1999], ['range', 2000, 2999]]);
  });

  test('no pide páginas de más cuando la última viene incompleta', async () => {
    tablaSize = 1000; // página exacta: hay que pedir una más para confirmar el fin
    const rows = await fetchLegacyRowsForUser({}, 1, 'tenant-1');
    expect(rows).toHaveLength(1000);
    expect(calls.filter(c => c[0] === 'range')).toHaveLength(2);
  });

  test('nunca supera MAX_MOVIMIENTOS_READ aunque la tabla sea mayor', async () => {
    tablaSize = MAX_MOVIMIENTOS_READ + 5000;
    const rows = await fetchLegacyRowsForUser({}, 1, 'tenant-1');
    expect(rows).toHaveLength(MAX_MOVIMIENTOS_READ);
  });
});
