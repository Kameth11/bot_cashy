// Vínculo con Google en profiles.google_sub (migración 014): solo si la columna existe.

jest.mock('fs', () => ({ existsSync: jest.fn(() => false), readFileSync: jest.fn(), writeFileSync: jest.fn() }));
jest.mock('../src/config', () => ({ CLIENTES_FILE: '/tmp/clientes_google_test.json', USE_SUPABASE: true }));
jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn(() => true) }));
jest.mock('../src/services/tenant-provisioning.service', () => ({ resolveOrCreateTenantId: jest.fn().mockResolvedValue('t1') }));

const { getSupabase } = require('../src/lib/supabase');
const clienteService = require('../src/services/cliente.service');

function crearSupabase(filas) {
  const ops = [];
  return {
    ops,
    from(tabla) {
      return {
        select: () => Promise.resolve({ data: filas, error: null }),
        upsert: (row) => { ops.push({ op: 'upsert', tabla, row }); return Promise.resolve({ error: null }); },
        update: (patch) => ({ eq: (c, v) => { ops.push({ op: 'update', tabla, patch, c, v }); return Promise.resolve({ error: null }); } }),
      };
    },
  };
}
const perfil = (id, extra = {}) => ({ id, sheet_id: `sheet-${id}`, email: `${id}@t.com`, usuarios: [], permisos: {}, ...extra });

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

test('sin la columna google_sub (migración sin correr) Google queda deshabilitado y no se escribe nada', async () => {
  const sb = crearSupabase([perfil(1)]);
  getSupabase.mockReturnValue(sb);
  await clienteService.cargarClientes();

  expect(clienteService.googleSoportado()).toBe(false);
  expect(await clienteService.vincularGoogle(1, 'SUB')).toEqual({ ok: false, motivo: 'no_disponible' });
  expect(sb.ops).toEqual([]);
  expect(clienteService.buildProfileRow('1', { sheetId: 's' })).not.toHaveProperty('google_sub');
});

test('con la columna: carga el sub, lo busca y lo escribe al vincular', async () => {
  const sb = crearSupabase([perfil(1, { google_sub: 'SUB-1' }), perfil(2, { google_sub: null })]);
  getSupabase.mockReturnValue(sb);
  await clienteService.cargarClientes();

  expect(clienteService.googleSoportado()).toBe(true);
  expect(clienteService.buscarPorGoogleSub('SUB-1')).toBe('1');
  expect(clienteService.buscarPorGoogleSub('NADA')).toBeNull();

  expect(await clienteService.vincularGoogle(2, 'SUB-2')).toEqual({ ok: true });
  const up = sb.ops.find((o) => o.op === 'upsert');
  expect(up.row).toMatchObject({ id: 2, google_sub: 'SUB-2' });
});

test('rechaza un sub de otra persona y una segunda cuenta de Google en la misma persona', async () => {
  getSupabase.mockReturnValue(crearSupabase([perfil(1, { google_sub: 'SUB-1' }), perfil(2, { google_sub: null })]));
  await clienteService.cargarClientes();

  expect(await clienteService.vincularGoogle(2, 'SUB-1')).toEqual({ ok: false, motivo: 'sub_en_uso' });
  expect(await clienteService.vincularGoogle(1, 'OTRO')).toEqual({ ok: false, motivo: 'ya_vinculada_otra' });
  expect(await clienteService.vincularGoogle(1, 'SUB-1')).toEqual({ ok: true }); // idempotente
});

test('desvincular limpia el sub en memoria y en la base', async () => {
  const sb = crearSupabase([perfil(1, { google_sub: 'SUB-1' })]);
  getSupabase.mockReturnValue(sb);
  await clienteService.cargarClientes();

  expect(await clienteService.desvincularGoogle(1)).toBe(true);
  expect(clienteService.buscarPorGoogleSub('SUB-1')).toBeNull();
  expect(sb.ops.find((o) => o.op === 'update')).toMatchObject({ patch: { google_sub: null }, c: 'id', v: 1 });
  expect(await clienteService.desvincularGoogle(1)).toBe(false);
});
