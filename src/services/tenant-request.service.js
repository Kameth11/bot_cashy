const { getSupabase, isAvailable } = require('../lib/supabase');
const { USE_SUPABASE } = require('../config');

function supabaseDisponible() {
  return USE_SUPABASE && isAvailable();
}

async function crearSolicitud(email, telegramUserId) {
  if (!supabaseDisponible()) return { ok: false, error: 'Supabase no disponible' };
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tenant_requests')
    .upsert(
      { email: email.toLowerCase().trim(), telegram_user_id: telegramUserId },
      { onConflict: 'email', ignoreDuplicates: false }
    )
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

async function buscarSolicitudPorEmail(email) {
  if (!supabaseDisponible()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tenant_requests')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();
  if (error || !data) return null;
  return data;
}

async function buscarSolicitudAprobadaPorTelegramId(telegramUserId) {
  if (!supabaseDisponible()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tenant_requests')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .eq('status', 'approved')
    .single();
  if (error || !data) return null;
  return data;
}

async function aprobarSolicitud(email, approvedBy) {
  if (!supabaseDisponible()) return { ok: false, error: 'Supabase no disponible' };
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tenant_requests')
    .update({ status: 'approved', approved_by: approvedBy, approved_at: new Date().toISOString() })
    .eq('email', email.toLowerCase().trim())
    .select()
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'No encontrado' };
  return { ok: true, data };
}

async function rechazarSolicitud(email, approvedBy) {
  if (!supabaseDisponible()) return { ok: false, error: 'Supabase no disponible' };
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tenant_requests')
    .update({ status: 'rejected', approved_by: approvedBy, approved_at: new Date().toISOString() })
    .eq('email', email.toLowerCase().trim())
    .select()
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'No encontrado' };
  return { ok: true, data };
}

async function listarSolicitudesPendientes() {
  if (!supabaseDisponible()) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tenant_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) return [];
  return data || [];
}

async function seedApprovedEmails(emails) {
  if (!supabaseDisponible() || !emails.length) return;
  const supabase = getSupabase();
  const rows = emails.map(email => ({
    email: email.toLowerCase().trim(),
    status: 'approved',
    approved_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from('tenant_requests')
    .upsert(rows, { onConflict: 'email', ignoreDuplicates: true });
  if (error) console.error('seedApprovedEmails error:', error.message);
  else console.log(`tenant_requests: ${emails.length} email(s) seedeados como approved`);
}

module.exports = {
  crearSolicitud,
  buscarSolicitudPorEmail,
  buscarSolicitudAprobadaPorTelegramId,
  aprobarSolicitud,
  rechazarSolicitud,
  listarSolicitudesPendientes,
  seedApprovedEmails,
};
