const { getSupabase } = require('./supabase');

// Unica forma permitida de tocar tablas de negocio en Supabase. Cualquier
// query que no pase por aca corre el riesgo de filtrar datos entre tenants
// (ver ARCHITECTURE.md seccion 3, Fase 2). scripts/check-tenant-isolation.js
// falla el build si aparece getSupabase().from(...) fuera de este archivo.
const SCOPED_TABLES = new Set([
  'movimientos',
  'movimientos_v2',
  'movimiento_eventos_v2',
  'profesionales',
  'obras_sociales',
  'prestaciones',
]);

function wrapBuilder(builder, tenantId) {
  const originalSelect = builder.select.bind(builder);
  const originalUpdate = builder.update.bind(builder);
  const originalDelete = builder.delete.bind(builder);
  const originalInsert = builder.insert.bind(builder);
  const originalUpsert = builder.upsert.bind(builder);

  builder.select = (...args) => originalSelect(...args).eq('tenant_id', tenantId);
  builder.update = (...args) => originalUpdate(...args).eq('tenant_id', tenantId);
  builder.delete = (...args) => originalDelete(...args).eq('tenant_id', tenantId);

  builder.insert = (rows) => {
    const conTenant = Array.isArray(rows)
      ? rows.map(row => ({ ...row, tenant_id: tenantId }))
      : { ...rows, tenant_id: tenantId };
    return originalInsert(conTenant);
  };

  builder.upsert = (rows, opts) => {
    const conTenant = Array.isArray(rows)
      ? rows.map(row => ({ ...row, tenant_id: tenantId }))
      : { ...rows, tenant_id: tenantId };
    return originalUpsert(conTenant, opts);
  };

  return builder;
}

// forTenant(tenantId).from('movimientos')... — nunca permite construir una
// query sin tenantId resuelto. `profiles` queda deliberadamente afuera: es
// la tabla que mapea userId -> tenantId, asi que se consulta sin tener
// todavia el tenant resuelto (ver tenant.service.js resolveTenantId).
function forTenant(tenantId) {
  if (!tenantId) {
    throw new Error('forTenant() llamado sin tenantId: query sin aislamiento de tenant bloqueada');
  }

  const supabase = getSupabase();
  if (!supabase) {
    return null;
  }

  return {
    from(table) {
      if (!SCOPED_TABLES.has(table)) {
        throw new Error(`Tabla '${table}' no esta en SCOPED_TABLES de tenant-db.js. Agregala si tiene datos de negocio, o usa getSupabase() directo si es deliberadamente global (ej: profiles).`);
      }
      return wrapBuilder(supabase.from(table), tenantId);
    },
  };
}

module.exports = { forTenant, SCOPED_TABLES };
