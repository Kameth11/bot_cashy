const { resolveOrCreateTenantId } = require('../src/services/tenant-provisioning.service');

function makeSupabase({ existingTenantId = null, insertError = null, insertedId = 'tenant-nuevo-uuid' } = {}) {
  return {
    from: jest.fn((table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: existingTenantId ? { tenant_id: existingTenantId } : null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'tenants') {
        return {
          insert: () => ({
            select: () => ({
              single: async () => insertError
                ? { data: null, error: insertError }
                : { data: { id: insertedId }, error: null },
            }),
          }),
        };
      }
      throw new Error(`tabla inesperada en el mock: ${table}`);
    }),
  };
}

describe('resolveOrCreateTenantId', () => {
  test('reusa el tenant_id de otro profile con el mismo sheet_id', async () => {
    const supabase = makeSupabase({ existingTenantId: 'tenant-existente' });
    const result = await resolveOrCreateTenantId(supabase, 'sheet-compartido');
    expect(result).toBe('tenant-existente');
  });

  test('sin sheetId, crea un tenant nuevo directamente', async () => {
    const supabase = makeSupabase();
    const result = await resolveOrCreateTenantId(supabase, null);
    expect(result).toBe('tenant-nuevo-uuid');
  });

  test('con sheetId pero sin tenant existente, crea uno nuevo', async () => {
    const supabase = makeSupabase({ existingTenantId: null });
    const result = await resolveOrCreateTenantId(supabase, 'sheet-nuevo');
    expect(result).toBe('tenant-nuevo-uuid');
  });

  test('si falla la creación del tenant, devuelve null (no revienta)', async () => {
    const supabase = makeSupabase({ insertError: { message: 'boom' } });
    const result = await resolveOrCreateTenantId(supabase, null);
    expect(result).toBeNull();
  });
});
