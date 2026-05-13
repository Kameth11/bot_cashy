const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, USE_SUPABASE } = require('../config');

let supabaseClient = null;
let createClient = null;
let requireAttempted = false;

function normalizeSupabaseUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';

  return raw
    .replace(/\/rest\/v1\/?$/i, '')
    .replace(/\/+$/g, '');
}

function loadFactory() {
  if (requireAttempted) {
    return createClient;
  }

  requireAttempted = true;

  try {
    ({ createClient } = require('@supabase/supabase-js'));
  } catch (error) {
    createClient = null;
    if (USE_SUPABASE) {
      console.error('Supabase habilitado pero falta instalar @supabase/supabase-js');
    }
  }

  return createClient;
}

function isAvailable() {
  return Boolean(USE_SUPABASE && normalizeSupabaseUrl(SUPABASE_URL) && (SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY) && loadFactory());
}

function getSupabase() {
  if (!isAvailable()) {
    return null;
  }

  if (!supabaseClient) {
    const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    supabaseClient = createClient(normalizeSupabaseUrl(SUPABASE_URL), key);
  }

  return supabaseClient;
}

module.exports = {
  getSupabase,
  isAvailable,
  normalizeSupabaseUrl,
};
