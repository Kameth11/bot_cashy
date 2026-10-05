// Salir del consultorio (/salir) o resetear la cuenta (/reiniciar) no puede llevarse el
// Personal de la persona: si el perfil tiene datos personales (FK en RESTRICT, migración
// 013) pasa a baja lógica (activo=false) en vez de borrarse.

jest.mock('fs', () => ({ existsSync: jest.fn(() => false), readFileSync: jest.fn(), writeFileSync: jest.fn() }));
jest.mock('../src/config', () => ({ CLIENTES_FILE: '/tmp/clientes_baja_logica_test.json', USE_SUPABASE: true }));
jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn(() => true) }));
jest.mock('../src/services/tenant-provisioning.service', () => ({ resolveOrCreateTenantId: jest.fn().mockResolvedValue('t1') }));

const { getSupabase } = require('../src/lib/supabase');
const clienteService = require('../src/services/cliente.service');

// Supabase falso para `profiles`: registra las operaciones y permite simular la FK.
function crearSupabase({ filas = [], errorAlBorrar = null } = {}) {
  const ops = [];
  return {
    ops,
    from(tabla) {
      return {
        select: () => Promise.resolve({ data: filas, error: null }),
        upsert: (row) => { ops.push({ op: 'upsert', tabla, row }); return Promise.resolve({ error: null }); },
        delete: () => ({ eq: (c, v) => { ops.push({ op: 'delete', tabla, c, v }); return Promise.resolve({ error: errorAlBorrar }); } }),
        update: (patch) => ({ eq: (c, v) => { ops.push({ op: 'update', tabla, patch, c, v }); return Promise.resolve({ error: null }); } }),
      };
    },
  };
}

const perfil = (id, extra = {}) => ({ id, sheet_id: `sheet-${id}`, email: `${id}@t.com`, usuarios: [], permisos: {}, ...extra });
const FK = { code: '23503', message: 'update or delete on table "profiles" violates foreign key constraint' };

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('cargarClientes con la columna activo', () => {
  test('ignora los perfiles dados de baja lógica', async () => {
    getSupabase.mockReturnValue(crearSupabase({ filas: [perfil(1, { activo: true }), perfil(2, { activo: false }), perfil(3, { activo: true })] }));
    await clienteService.cargarClientes();
    expect(Object.keys(clienteService.clientes).sort()).toEqual(['1', '3']);
  });

  test('sin la columna (migración sin aplicar) todos siguen siendo clientes', async () => {
    getSupabase.mockReturnValue(crearSupabase({ filas: [perfil(1), perfil(2)] }));
    await clienteService.cargarClientes();
    expect(Object.keys(clienteService.clientes).sort()).toEqual(['1', '2']);
  });
});

describe('buildProfileRow: la columna activo solo viaja si existe', () => {
  test('sin la columna en la base NO se manda (no rompe el alta de perfiles)', async () => {
    getSupabase.mockReturnValue(crearSupabase({ filas: [perfil(1)] }));
    await clienteService.cargarClientes();
    expect(clienteService.buildProfileRow('9', { sheetId: 's' })).not.toHaveProperty('activo');
  });

  test('con la columna se manda en true: re-registrarse reactiva un perfil dado de baja', async () => {
    getSupabase.mockReturnValue(crearSupabase({ filas: [perfil(1, { activo: true })] }));
    await clienteService.cargarClientes();
    expect(clienteService.buildProfileRow('9', { sheetId: 's' }).activo).toBe(true);
  });
});

describe('eliminarCliente', () => {
  async function conClientes(supabase) {
    getSupabase.mockReturnValue(supabase);
    await clienteService.cargarClientes();
  }

  test('sin datos personales: el perfil se borra como siempre', async () => {
    const sb = crearSupabase({ filas: [perfil(10, { activo: true })] });
    await conClientes(sb);
    expect(await clienteService.eliminarCliente(10)).toBe(true);
    expect(sb.ops.filter(o => o.op === 'delete')).toHaveLength(1);
    expect(sb.ops.filter(o => o.op === 'update')).toHaveLength(0);
    expect(clienteService.clientes['10']).toBeUndefined();
  });

  test('CON Personal (FK): baja lógica, el perfil NO se borra y la persona deja de ser cliente', async () => {
    const sb = crearSupabase({ filas: [perfil(10, { activo: true })], errorAlBorrar: FK });
    await conClientes(sb);
    expect(await clienteService.eliminarCliente(10)).toBe(true);

    const bajas = sb.ops.filter(o => o.op === 'update');
    expect(bajas).toHaveLength(1);
    expect(bajas[0]).toMatchObject({ tabla: 'profiles', patch: { activo: false, usuarios: [] }, c: 'id', v: 10 });
    expect(clienteService.clientes['10']).toBeUndefined();
  });

  test('un invitado que sale con Personal: se lo saca de usuarios[] del dueño y se da de baja', async () => {
    const sb = crearSupabase({ filas: [perfil(1, { activo: true, usuarios: [3333, 4444] })], errorAlBorrar: FK });
    await conClientes(sb);
    expect(await clienteService.eliminarCliente(3333)).toBe(true);

    const dueno = sb.ops.find(o => o.op === 'update' && o.v === 1);
    expect(dueno.patch).toEqual({ usuarios: [4444] });
    expect(sb.ops.find(o => o.op === 'update' && o.v === 3333).patch).toMatchObject({ activo: false });
  });

  test('otro error de la base NO dispara la baja lógica (solo se informa)', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const sb = crearSupabase({ filas: [perfil(10, { activo: true })], errorAlBorrar: { code: 'XX000', message: 'caída' } });
    await conClientes(sb);
    await clienteService.eliminarCliente(10);
    expect(sb.ops.filter(o => o.op === 'update')).toHaveLength(0);
  });

  test('un cliente que no existe devuelve false', async () => {
    const sb = crearSupabase({ filas: [perfil(10, { activo: true })] });
    await conClientes(sb);
    expect(await clienteService.eliminarCliente(999)).toBe(false);
  });
});
