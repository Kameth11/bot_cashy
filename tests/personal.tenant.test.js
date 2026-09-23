// Aislamiento del ámbito personal.
//
// Doble candado: el wrapper `forTenant` aísla por consultorio, y el service
// filtra además por `user_id`. Sin ese segundo filtro, un socio del mismo
// consultorio vería los gastos personales del otro — que es exactamente lo que
// el ámbito personal tiene que evitar.

jest.mock('../src/lib/supabase', () => ({
  getSupabase: jest.fn(),
  isAvailable: jest.fn(() => true),
}));

const { getSupabase } = require('../src/lib/supabase');
const { forTenant, SCOPED_TABLES } = require('../src/lib/tenant-db');

// Supabase falso que registra los filtros aplicados a cada query.
function makeFakeSupabase() {
  const llamadas = [];

  function makeChain(tabla, op) {
    const registro = { tabla, op, filtros: {}, payload: null };
    llamadas.push(registro);
    const chain = {
      eq(col, val) { registro.filtros[col] = val; return chain; },
      select() { return chain; },
      single() { return chain; },
      limit() { return chain; },
      _registro: registro,
    };
    return chain;
  }

  return {
    llamadas,
    from(tabla) {
      return {
        insert(rows) {
          const chain = makeChain(tabla, 'insert');
          chain._registro.payload = rows;
          return chain;
        },
        upsert(rows) {
          const chain = makeChain(tabla, 'upsert');
          chain._registro.payload = rows;
          return chain;
        },
        select() { return makeChain(tabla, 'select'); },
        update() { return makeChain(tabla, 'update'); },
        delete() { return makeChain(tabla, 'delete'); },
      };
    },
  };
}

describe('tablas personales registradas en SCOPED_TABLES', () => {
  test.each(['movimientos_personales', 'viajes_personales', 'presupuestos_personales'])(
    '%s está registrada, así forTenant no la rechaza',
    (tabla) => {
      expect(SCOPED_TABLES.has(tabla)).toBe(true);
    }
  );

  test('una tabla personal inventada sigue siendo rechazada', () => {
    getSupabase.mockReturnValue(makeFakeSupabase());
    expect(() => forTenant('t1').from('gastos_personales')).toThrow(/SCOPED_TABLES/);
  });
});

describe('aislamiento por tenant en movimientos personales', () => {
  let fake;
  beforeEach(() => {
    fake = makeFakeSupabase();
    getSupabase.mockReturnValue(fake);
  });

  test('el insert lleva el tenant_id inyectado por el wrapper', () => {
    forTenant('tenant-A').from('movimientos_personales').insert({
      user_id: 111,
      categoria: 'supermercado',
      monto_original: 45000,
    });

    const [registro] = fake.llamadas;
    expect(registro.payload).toMatchObject({ user_id: 111, tenant_id: 'tenant-A' });
  });

  test('el borrado filtra por tenant Y por user_id', () => {
    forTenant('tenant-A')
      .from('movimientos_personales')
      .delete()
      .eq('legacy_id', 'pers_1')
      .eq('user_id', 111);

    const [registro] = fake.llamadas;
    expect(registro.filtros).toMatchObject({
      tenant_id: 'tenant-A',
      legacy_id: 'pers_1',
      user_id: 111,
    });
  });

  test('dos usuarios del mismo tenant quedan separados por user_id', () => {
    // Mismo consultorio, personas distintas: el tenant_id no alcanza para
    // separarlos, hace falta el user_id.
    forTenant('tenant-A').from('movimientos_personales').select().eq('user_id', 111);
    forTenant('tenant-A').from('movimientos_personales').select().eq('user_id', 222);

    const [deUno, delOtro] = fake.llamadas;
    expect(deUno.filtros.tenant_id).toBe(delOtro.filtros.tenant_id);
    expect(deUno.filtros.user_id).not.toBe(delOtro.filtros.user_id);
  });

  test('forTenant sin tenantId no deja pasar la query', () => {
    expect(() => forTenant(null)).toThrow(/sin tenantId/);
    expect(() => forTenant(undefined)).toThrow(/sin tenantId/);
    expect(() => forTenant('')).toThrow(/sin tenantId/);
  });
});

describe('el upsert de presupuestos también lleva tenant_id', () => {
  test('un presupuesto se guarda con el tenant inyectado', () => {
    const fake = makeFakeSupabase();
    getSupabase.mockReturnValue(fake);

    forTenant('tenant-A').from('presupuestos_personales').upsert({
      user_id: 111,
      categoria: 'supermercado',
      monto_mensual: 450000,
    });

    expect(fake.llamadas[0].payload).toMatchObject({
      user_id: 111,
      tenant_id: 'tenant-A',
    });
  });
});
