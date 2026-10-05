// forPersona: aislamiento POR PERSONA dentro de un tenant. Es lo que impide que, con
// Personal abierto a todos, un olvido de `.eq('user_id', ...)` filtre datos ajenos.

jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn(() => true) }));

const { getSupabase } = require('../src/lib/supabase');
const { forPersona, PERSONA_TABLES } = require('../src/lib/persona-db');
const { crearSupabaseFalso } = require('./helpers/fake-supabase');

let fake;
beforeEach(() => {
  fake = crearSupabaseFalso();
  getSupabase.mockReturnValue(fake);
});
const ultima = () => fake.llamadas[fake.llamadas.length - 1];

describe('filtros automáticos', () => {
  test('select: agrega tenant_id Y user_id', async () => {
    await forPersona('t1', 7).from('movimientos_personales').select('*');
    expect(ultima().filtros).toEqual({ tenant_id: 't1', user_id: 7 });
  });

  test('delete: agrega tenant_id y user_id aunque quien llama no los ponga', async () => {
    await forPersona('t1', 7).from('movimientos_personales').delete().eq('legacy_id', 'x');
    expect(ultima().filtros).toEqual({ tenant_id: 't1', user_id: 7, legacy_id: 'x' });
  });

  test('update: filtra por persona y descarta user_id/tenant_id del payload (no se puede mover una fila a otra persona)', async () => {
    await forPersona('t1', 7).from('presupuestos_personales').update({ activo: false, user_id: 999, tenant_id: 'otro' });
    expect(ultima().payload).toEqual({ activo: false });
    expect(ultima().filtros).toMatchObject({ tenant_id: 't1', user_id: 7 });
  });

  test('userId llega como string: se normaliza a número', async () => {
    await forPersona('t1', '7').from('movimientos_personales').select('*');
    expect(ultima().filtros.user_id).toBe(7);
  });
});

describe('escrituras: la persona es SIEMPRE la del wrapper', () => {
  test('insert ignora un user_id distinto que mande quien llama', async () => {
    await forPersona('t1', 7).from('movimientos_personales').insert({ user_id: 999, categoria: 'otros' });
    expect(ultima().payload).toEqual({ categoria: 'otros', user_id: 7, tenant_id: 't1' });
  });

  test('insert de varias filas', async () => {
    await forPersona('t1', 7).from('movimientos_personales').insert([{ user_id: 1 }, { user_id: 2 }]);
    expect(ultima().payload.map(r => r.user_id)).toEqual([7, 7]);
  });

  test('upsert también fuerza la persona', async () => {
    await forPersona('t1', 7).from('preferencias_ambito_personales').upsert({ termino: 'luz', ambito: 'personal', user_id: 5 }, { onConflict: 'user_id,termino' });
    expect(ultima().payload).toMatchObject({ user_id: 7, tenant_id: 't1' });
  });
});

describe('aislamiento entre dos personas del mismo tenant', () => {
  test('cada una ve y borra solo lo suyo', async () => {
    const ana = forPersona('t1', 1);
    const beto = forPersona('t1', 2);
    await ana.from('movimientos_personales').insert({ legacy_id: 'a1', categoria: 'otros' });
    await beto.from('movimientos_personales').insert({ legacy_id: 'b1', categoria: 'otros' });

    const deAna = (await ana.from('movimientos_personales').select('*')).data;
    expect(deAna.map(f => f.legacy_id)).toEqual(['a1']);

    // Beto intenta borrar la fila de Ana por su legacy_id: no borra nada.
    const borradas = (await beto.from('movimientos_personales').delete().eq('legacy_id', 'a1').select('id')).data;
    expect(borradas).toEqual([]);
    expect(fake.tablas.movimientos_personales.map(f => f.legacy_id).sort()).toEqual(['a1', 'b1']);
  });

  test('y no se cruzan entre tenants', async () => {
    await forPersona('t1', 1).from('movimientos_personales').insert({ legacy_id: 'x', categoria: 'otros' });
    const otro = (await forPersona('t2', 1).from('movimientos_personales').select('*')).data;
    expect(otro).toEqual([]);
  });
});

describe('protecciones', () => {
  test('sin userId o con userId inválido: lanza (no se puede armar una consulta sin persona)', () => {
    expect(() => forPersona('t1')).toThrow(/sin userId/);
    expect(() => forPersona('t1', '')).toThrow(/sin userId/);
    expect(() => forPersona('t1', null)).toThrow(/sin userId/);
    expect(() => forPersona('t1', 'abc')).toThrow(/inválido/);
  });

  test('sin tenant: lanza (lo hace forTenant)', () => {
    expect(() => forPersona(null, 7)).toThrow(/tenantId/);
  });

  test('una tabla que no es personal se rechaza', () => {
    expect(() => forPersona('t1', 7).from('movimientos')).toThrow(/no es una tabla personal/);
    expect(() => forPersona('t1', 7).from('profiles')).toThrow(/no es una tabla personal/);
  });

  test('sin Supabase configurado devuelve null', () => {
    getSupabase.mockReturnValue(null);
    expect(forPersona('t1', 7)).toBeNull();
  });

  test('las cuatro tablas personales están cubiertas', () => {
    expect([...PERSONA_TABLES].sort()).toEqual([
      'movimientos_personales', 'preferencias_ambito_personales', 'presupuestos_personales', 'viajes_personales',
    ]);
  });
});
