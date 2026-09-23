// Ítem 2.2: la migración 003 puso profiles.tenant_id NOT NULL, pero
// buildProfileRow nunca lo incluía, así que el upsert de un perfil NUEVO
// fallaba por constraint violation en Postgres. Como supabase-js devuelve
// el error en vez de lanzarlo, y el try/catch de guardarClientes solo
// atrapa excepciones reales (no el `{ error }` de una promesa resuelta),
// la falla era 100% silenciosa: el usuario quedaba sin fila en `profiles`
// y nadie se enteraba. En Railway, clientes.json (el respaldo local) se
// borra en cada deploy, así que un usuario que se registró pero todavía no
// hizo ningún movimiento (ensureProfile nunca corrió para él) perdía su
// alta por completo en el próximo deploy.
//
// Cómo verificarlo en producción (sin este fix): registrar un usuario de
// prueba con /start (USE_SUPABASE=true) y, ANTES de cargar cualquier
// movimiento, correr en el SQL editor de Supabase:
//   select * from profiles where id = <su telegram id>;
// Con el bug, la fila no existe. `guardarClientes` no deja ningún log de
// error explicando por qué.

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('../src/config', () => ({
  CLIENTES_FILE: '/tmp/clientes_supabase_sync_test.json',
  USE_SUPABASE: true,
}));

jest.mock('../src/lib/supabase', () => ({
  getSupabase: jest.fn(),
  isAvailable: jest.fn(() => true),
}));

jest.mock('../src/services/tenant-provisioning.service', () => ({
  resolveOrCreateTenantId: jest.fn(),
}));

const { getSupabase } = require('../src/lib/supabase');
const { resolveOrCreateTenantId } = require('../src/services/tenant-provisioning.service');
const clienteService = require('../src/services/cliente.service');

function makeSupabaseSpy() {
  const calls = { upsert: [], update: [], delete: [] };
  return {
    calls,
    from: jest.fn((table) => ({
      upsert: jest.fn((row, opts) => {
        calls.upsert.push({ table, row, opts });
        return Promise.resolve({ data: [row], error: null });
      }),
      update: jest.fn((patch) => {
        calls.update.push({ table, patch });
        return { eq: jest.fn(() => Promise.resolve({ data: null, error: null })) };
      }),
      delete: jest.fn(() => {
        calls.delete.push({ table });
        return { eq: jest.fn(() => Promise.resolve({ data: null, error: null })) };
      }),
    })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clienteService.clientes = {};
});

describe('buildProfileRow — confirmación del bug (tenant_id ausente)', () => {
  test('sin tenantId, el row NO incluye tenant_id (repro: así fallaba el insert en Postgres)', () => {
    const row = clienteService.buildProfileRow('5000', { sheetId: 's', email: 'a@b.com', usuarios: [] });
    expect(row).not.toHaveProperty('tenant_id');
  });

  test('con tenantId resuelto, el row lo incluye', () => {
    const row = clienteService.buildProfileRow('5000', { sheetId: 's' }, 'tenant-xyz');
    expect(row.tenant_id).toBe('tenant-xyz');
  });
});

describe('guardarClientes — resuelve tenant_id y solo sube la fila que cambió', () => {
  test('perfil nuevo: resuelve tenant_id vía resolveOrCreateTenantId e incluye en el upsert', async () => {
    const supabase = makeSupabaseSpy();
    getSupabase.mockReturnValue(supabase);
    resolveOrCreateTenantId.mockResolvedValue('tenant-abc');

    const clientes = { '5000': { sheetId: 'sheet-nuevo', email: 'nuevo@x.com', usuarios: [] } };
    await clienteService.guardarClientes(clientes, '5000');

    expect(resolveOrCreateTenantId).toHaveBeenCalledWith(supabase, 'sheet-nuevo');
    expect(supabase.calls.upsert).toHaveLength(1);
    expect(supabase.calls.upsert[0].row).toMatchObject({ id: 5000, tenant_id: 'tenant-abc' });
  });

  test('con changedUserId, NO toca los perfiles de otros usuarios (antes hacía upsert de todos)', async () => {
    const supabase = makeSupabaseSpy();
    getSupabase.mockReturnValue(supabase);
    resolveOrCreateTenantId.mockResolvedValue('tenant-abc');

    const clientes = {
      '5000': { sheetId: 'sheet-a', usuarios: [] },
      '6000': { sheetId: 'sheet-b', usuarios: [] },
      '7000': { sheetId: 'sheet-c', usuarios: [] },
    };
    await clienteService.guardarClientes(clientes, '6000');

    expect(supabase.calls.upsert).toHaveLength(1);
    expect(supabase.calls.upsert[0].row.id).toBe(6000);
  });

  test('sin changedUserId (seed inicial), sincroniza todos', async () => {
    const supabase = makeSupabaseSpy();
    getSupabase.mockReturnValue(supabase);
    resolveOrCreateTenantId.mockResolvedValue('tenant-abc');

    const clientes = {
      '5000': { sheetId: 'sheet-a', usuarios: [] },
      '6000': { sheetId: 'sheet-b', usuarios: [] },
    };
    await clienteService.guardarClientes(clientes);

    expect(supabase.calls.upsert).toHaveLength(2);
  });

  test('si el upsert falla, el error queda logueado (antes: silencio total)', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeSupabaseSpy();
    supabase.from = jest.fn(() => ({
      upsert: jest.fn(() => Promise.resolve({
        data: null,
        error: { message: 'null value in column "tenant_id" violates not-null constraint' },
      })),
    }));
    getSupabase.mockReturnValue(supabase);
    resolveOrCreateTenantId.mockResolvedValue(null); // no se pudo resolver

    const clientes = { '5000': { sheetId: 'sheet-x', usuarios: [] } };
    await clienteService.guardarClientes(clientes, '5000');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('userId=5000'),
      expect.stringContaining('not-null constraint')
    );
    errorSpy.mockRestore();
  });
});

describe('setPermisos — loguea el error de Supabase en vez de tragárselo', () => {
  test('update falla → se loguea con el ownerId', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    clienteService.clientes = { '2222': { sheetId: 's', usuarios: [3333], permisos: {} } };

    const supabase = {
      from: jest.fn(() => ({
        update: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: null, error: { message: 'row not found' } })),
        })),
      })),
    };
    getSupabase.mockReturnValue(supabase);

    await clienteService.setPermisos(2222, 3333, ['ver_agenda']);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ownerId=2222'),
      expect.stringContaining('row not found')
    );
    errorSpy.mockRestore();
  });
});
