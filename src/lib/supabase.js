const { SUPABASE_URL, SUPABASE_ANON_KEY, USE_SUPABASE } = require('../config');

let supabaseClient = null;
let createClient = null;
let requireAttempted = false;

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
  return Boolean(USE_SUPABASE && SUPABASE_URL && SUPABASE_ANON_KEY && loadFactory());
}

function getSupabase() {
  if (!isAvailable()) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  return supabaseClient;
}

module.exports = {
  getSupabase,
  isAvailable,
};
