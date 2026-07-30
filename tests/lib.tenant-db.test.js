// Barrera de seguridad multi-tenant: forTenant() es la unica forma permitida
// de tocar tablas de negocio en Supabase y debe inyectar tenant_id en TODA
// query. Un bug aca = fuga de datos entre consultorios. Estos tests clavan su
// contrato de runtime (el check:tenant del CI solo hace analisis estatico).

jest.mock('../src/lib/supabase', () => ({
  getSupabase: jest.fn(),
}));

const { getSupabase } = require('../src/lib/supabase');
const { forTenant, SCOPED_TABLES } = require('../src/lib/tenant-db');

// Supabase falso que registra cada llamada para poder afirmar que tenant_id
// se inyecto donde corresponde. select/update/delete devuelven un objeto con
// .eq() encadenable (que es donde forTenant agrega el filtro de tenant).
function makeFakeSupabase() {
  const calls = [];
  function queryResult() {
    const qr = {
      eq(field, value) { calls.push(['eq', field, value]); return qr; },
    };
    return qr;
  }
  function makeBuilder(table) {
    return {
      table,
      select: (...args) => { calls.push(['select', ...args]); return queryResult(); },
      update: (payload) => { calls.push(['update', payload]); return queryResult(); },
      delete: () => { calls.push(['delete']); return queryResult(); },
      insert: (rows) => { calls.push(['insert', rows]); return queryResult(); },
      upsert: (rows, opts) => { calls.push(['upsert', rows, opts]); return queryResult(); },
    };
  }
  return {
    calls,
    from: (table) => { calls.push(['from', table]); return makeBuilder(table); },
  };
}

describe('lib/tenant-db forTenant', () => {
  let fake;
  beforeEach(() => {
    fake = makeFakeSupabase();
    getSupabase.mockReturnValue(fake);
  });

  test('lanza si no hay tenantId (query sin aislamiento bloqueada)', () => {
    for (const sinTenant of [null, undefined, '', 0]) {
      expect(() => forTenant(sinTenant)).toThrow(/sin aislamiento de tenant/i);
    }
  });

  test('devuelve null si Supabase no esta disponible (no lanza)', () => {
    getSupabase.mockReturnValue(null);
    expect(forTenant('tenant-1')).toBeNull();
  });

  test('.from() lanza si la tabla no esta en SCOPED_TABLES', () => {
    expect(() => forTenant('tenant-1').from('profiles')).toThrow(/SCOPED_TABLES/);
    expect(() => forTenant('tenant-1').from('tabla_inventada')).toThrow(/SCOPED_TABLES/);
  });

  test('SCOPED_TABLES contiene solo las tablas reales de negocio', () => {
    expect([...SCOPED_TABLES].sort()).toEqual(['movimientos', 'profesionales']);
  });

  test('select inyecta .eq(tenant_id) automaticamente', () => {
    forTenant('tenant-1').from('movimientos').select('*');
    expect(fake.calls).toContainEqual(['select', '*']);
    expect(fake.calls).toContainEqual(['eq', 'tenant_id', 'tenant-1']);
  });

  test('update inyecta .eq(tenant_id) automaticamente', () => {
    forTenant('tenant-9').from('movimientos').update({ estado: 'Cobrado' });
    expect(fake.calls).toContainEqual(['update', { estado: 'Cobrado' }]);
    expect(fake.calls).toContainEqual(['eq', 'tenant_id', 'tenant-9']);
  });

  test('delete inyecta .eq(tenant_id) automaticamente', () => {
    forTenant('tenant-7').from('profesionales').delete();
    expect(fake.calls).toContainEqual(['delete']);
    expect(fake.calls).toContainEqual(['eq', 'tenant_id', 'tenant-7']);
  });

  test('insert agrega tenant_id al row (objeto unico)', () => {
    forTenant('tenant-1').from('movimientos').insert({ descripcion: 'x', monto: 100 });
    const insertCall = fake.calls.find(c => c[0] === 'insert');
    expect(insertCall[1]).toEqual({ descripcion: 'x', monto: 100, tenant_id: 'tenant-1' });
  });

  test('insert agrega tenant_id a cada row (array)', () => {
    forTenant('tenant-2').from('movimientos').insert([{ a: 1 }, { a: 2 }]);
    const insertCall = fake.calls.find(c => c[0] === 'insert');
    expect(insertCall[1]).toEqual([
      { a: 1, tenant_id: 'tenant-2' },
      { a: 2, tenant_id: 'tenant-2' },
    ]);
  });

  test('upsert agrega tenant_id y conserva las opciones', () => {
    forTenant('tenant-3').from('movimientos').upsert({ id: 5 }, { onConflict: 'id' });
    const upsertCall = fake.calls.find(c => c[0] === 'upsert');
    expect(upsertCall[1]).toEqual({ id: 5, tenant_id: 'tenant-3' });
    expect(upsertCall[2]).toEqual({ onConflict: 'id' });
  });

  test('no muta el row original del caller al insertar', () => {
    const original = { descripcion: 'x' };
    forTenant('tenant-1').from('movimientos').insert(original);
    expect(original).toEqual({ descripcion: 'x' }); // sin tenant_id agregado
  });
});
