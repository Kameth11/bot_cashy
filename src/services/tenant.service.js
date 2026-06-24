const { getSupabase } = require('../lib/supabase');
const { obtenerClientePorUserId } = require('../auth');

// Cache en memoria de proceso ownerId -> tenantId, mismo patron que
// legacyCapabilityCache/v2CapabilityCache en db.service.js.
const tenantIdCache = new Map();

function resolverOwnerId(userId) {
  const cliente = obtenerClientePorUserId(userId);
  return cliente ? Number(cliente.ownerId) : Number(userId);
}

// Resuelve el tenantId (uuid de la tabla tenants) a partir de un userId de
// Telegram, sea el owner o un usuario invitado. Usa profiles directamente
// (no el wrapper de tenant-db.js: profiles es la tabla que mapea
// userId -> tenantId, no tiene sentido pedirle el tenantId a si misma).
async function resolveTenantId(userId) {
  const ownerId = resolverOwnerId(userId);
  if (tenantIdCache.has(ownerId)) {
    return tenantIdCache.get(ownerId);
  }

  const supabase = getSupabase();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', ownerId)
    .maybeSingle();

  if (error || !data?.tenant_id) {
    return null;
  }

  tenantIdCache.set(ownerId, data.tenant_id);
  return data.tenant_id;
}

function invalidateTenantCache(userId) {
  tenantIdCache.delete(resolverOwnerId(userId));
}

module.exports = { resolveTenantId, invalidateTenantCache };
