// Resuelve o crea el tenant de un sheet_id. Vive en un módulo aparte (sin
// requires internos más que console) a propósito: tanto db.service.js como
// cliente.service.js lo necesitan, y cliente.service.js es requerido por
// auth/index.js — si esto viviera en tenant.service.js (que a su vez
// requiere ../auth) o en db.service.js (que requiere ../auth también),
// cliente.service.js → ese módulo → auth/index.js → cliente.service.js
// sería un require circular.

// Resuelve el tenant de un sheet_id (otro profile ya creado con el mismo
// sheet, ej: el owner cuando este perfil es de un usuario invitado) o crea
// un tenant nuevo. profiles/tenants quedan fuera de tenant-db.js a
// proposito: son las tablas que definen el mapeo userId -> tenantId, no
// tiene sentido pedirles el tenantId a si mismas (ver tenant.service.js).
async function resolveOrCreateTenantId(supabase, sheetId) {
  if (sheetId) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('sheet_id', sheetId)
      .not('tenant_id', 'is', null)
      .limit(1)
      .maybeSingle();
    if (existing?.tenant_id) return existing.tenant_id;
  }

  const { data: tenant, error } = await supabase
    .from('tenants')
    .insert({ nombre: sheetId ? `Consultorio ${sheetId.slice(0, 8)}` : 'Consultorio sin sheet' })
    .select('id')
    .single();

  if (error) {
    console.error('Supabase resolveOrCreateTenantId error:', error.message);
    return null;
  }
  return tenant.id;
}

module.exports = { resolveOrCreateTenantId };
