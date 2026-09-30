// Con Supabase, editar/borrar un movimiento debe buscarlo por id_unico en la DB,
// no traer todo el historial del tenant para buscarlo en memoria.

process.env.USE_SUPABASE = 'true';
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';

const calls = [];
let resultado = [];
const builder = {
  select: (...a) => { calls.push(['select', ...a]); return builder; },
  eq: (...a) => { calls.push(['eq', ...a]); return builder; },
  order: (...a) => { calls.push(['order', ...a]); return builder; },
  range: (...a) => { calls.push(['range', ...a]); return Promise.resolve({ data: [], error: null }); },
  limit: (...a) => { calls.push(['limit', ...a]); return Promise.resolve({ data: resultado, error: null }); },
};

jest.mock('../src/config', () => ({
  ...jest.requireActual('../src/config'),
  USE_SUPABASE: true,
}));
jest.mock('../src/lib/supabase', () => ({ getSupabase: () => ({}), isAvailable: () => true }));
jest.mock('../src/lib/tenant-db', () => ({ SCOPED_TABLES: new Set(['movimientos']), forTenant: jest.fn(() => ({ from: () => builder })) }));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn().mockResolvedValue('t1'), invalidateTenantCache: jest.fn() }));

const db = require('../src/services/db.service');

describe('findRowByIdUnico con Supabase', () => {
  beforeEach(() => { calls.length = 0; });

  test('consulta por id_unico y no lee el historial completo', async () => {
    resultado = [{ id: 7, id_unico: 'abc', descripcion: 'x', monto: 10 }];
    const row = await db.findRowByIdUnico(1, 'abc');
    expect(row.id).toBe(7);
    expect(row.get('ID_Unico')).toBe('abc');
    expect(calls).toContainEqual(['eq', 'id_unico', 'abc']);
    expect(calls.find(c => c[0] === 'range')).toBeUndefined();
  });
});
