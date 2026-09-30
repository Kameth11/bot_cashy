// referencia_id es UUID en Supabase. Los comprobantes vinculan el movimiento con
// "comp:<id>": mandado tal cual, Postgres rechaza el insert entero y el
// movimiento queda solo en el Sheet (no aparece en el dashboard ni en los
// comandos del bot, que leen de Supabase).

const mockInserts = [];
jest.mock('../src/config', () => ({ ...jest.requireActual('../src/config'), USE_SUPABASE: true }));
jest.mock('../src/lib/supabase', () => {
  const chain = (data) => { const b = { select: () => b, eq: () => b, limit: () => Promise.resolve({ error: null }), maybeSingle: async () => ({ data, error: null }) }; return b; };
  return { isAvailable: () => true, getSupabase: () => ({ from: (t) => (t === 'profiles' ? chain({ id: 1, tenant_id: 't1' }) : chain(null)) }) };
});
jest.mock('../src/lib/tenant-db', () => ({
  SCOPED_TABLES: new Set(['movimientos']),
  forTenant: () => ({ from: () => ({ insert: (row) => { mockInserts.push(row); return { select: () => ({ single: async () => ({ data: { id: 'x', ...row }, error: null }) }) }; } }) }),
}));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn().mockResolvedValue('t1'), invalidateTenantCache: jest.fn() }));
jest.mock('../src/services/sheet.service', () => ({ getSheetCliente: jest.fn().mockResolvedValue(null), ensureSheetStructure: jest.fn(), invalidateCache: jest.fn() }));

const db = require('../src/services/db.service');
const base = { Fecha: '30/09/2026', Hora: '10:00', Descripcion: 'Transferencia - Juan', Monto: 30000, Estado: 'Cobrado', Tipo: 'Ingreso', Moneda: 'Pesos', MetodoPago: 'transferencia', ID_Unico: 'u1', MontoPesos: 30000, ID_Origen: '1' };

beforeEach(() => { mockInserts.length = 0; });

test('un vínculo "comp:<id>" NO se manda a la columna uuid', async () => {
  const r = await db.addRow(1, { ...base, ReferenciaId: 'comp:comp_123_abc' });
  expect(r).toBeTruthy();
  expect(mockInserts).toHaveLength(1);
  expect(mockInserts[0].referencia_id).toBeNull();
});

test('un uuid real sí se conserva', async () => {
  const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  await db.addRow(1, { ...base, ReferenciaId: uuid });
  expect(mockInserts[0].referencia_id).toBe(uuid);
});

test('sin vínculo: null', async () => {
  await db.addRow(1, base);
  expect(mockInserts[0].referencia_id).toBeNull();
});

describe('movimientos_v2: mismo problema, la columna también es uuid', () => {
  const { buildMovimientoV2Payload } = require('../src/utils/movimiento-v2');

  test('"comp:<id>" no va a referencia_id; queda en notas', () => {
    const p = buildMovimientoV2Payload({ userId: 1, rowData: base, metadata: { referenciaId: 'comp:comp_1', notas: 'pagó Juan' } });
    expect(p.referencia_id).toBeNull();
    expect(p.notas).toBe('pagó Juan | comp:comp_1');
  });

  test('un uuid real sí va a referencia_id y no ensucia notas', () => {
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const p = buildMovimientoV2Payload({ userId: 1, rowData: base, metadata: { referenciaId: uuid } });
    expect(p.referencia_id).toBe(uuid);
    expect(p.notas).toBeNull();
  });
});
