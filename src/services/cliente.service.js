const fs = require('fs');
const { CLIENTES_FILE, USE_SUPABASE } = require('../config');
const { getSupabase, isAvailable } = require('../lib/supabase');

let clientes = {};

function buildProfileRow(userId, clienteData = {}) {
  return {
    id: parseInt(userId, 10),
    web_user_id: clienteData.webUserId || null,
    email: clienteData.email || null,
    display_name: clienteData.display_name || (clienteData.email ? clienteData.email.split('@')[0] : null),
    sheet_id: clienteData.sheetId || null,
    plan: clienteData.plan || 'free',
    usuarios: Array.isArray(clienteData.usuarios) ? clienteData.usuarios : [],
  };
}

async function cargarClientes() {
  if (USE_SUPABASE && isAvailable()) {
    const supabase = getSupabase();
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*');

      if (error) {
        console.error('Supabase cargarClientes error:', error.message);
        return cargarClientesLocal();
      }

      if (!data || data.length === 0) {
        const localClientes = cargarClientesLocal();
        if (Object.keys(localClientes).length > 0) {
          await guardarClientes(localClientes);
        }
        return localClientes;
      }

      clientes = {};
      for (const profile of data) {
        const userId = String(profile.id);
        clientes[userId] = {
          sheetId: profile.sheet_id || null,
          email: profile.email || null,
          telegramUserId: profile.id,
          usuarios: profile.usuarios || [],
          creadoEn: profile.created_at || new Date().toISOString(),
        };
      }
      console.log(`Clientes cargados desde Supabase: ${Object.keys(clientes).length}`);
      return clientes;
    } catch (err) {
      console.error('Supabase cargarClientes catch:', err.message);
      return cargarClientesLocal();
    }
  }
  return cargarClientesLocal();
}

function cargarClientesLocal() {
  try {
    if (fs.existsSync(CLIENTES_FILE)) {
      const data = fs.readFileSync(CLIENTES_FILE, 'utf8');
      clientes = JSON.parse(data);
    }
  } catch (error) {
    console.error('Error al cargar clientes local:', error.message);
    clientes = {};
  }
  console.log(`Clientes cargados (local): ${Object.keys(clientes).length}`);
  return clientes;
}

async function guardarClientes(clientesObj) {
  clientes = clientesObj;

  // always save locally as backup
  try {
    fs.writeFileSync(CLIENTES_FILE, JSON.stringify(clientesObj, null, 2));
  } catch (error) {
    console.error('Error al guardar clientes local:', error.message);
  }

  if (USE_SUPABASE && isAvailable()) {
    try {
      const supabase = getSupabase();
      for (const [userId, clienteData] of Object.entries(clientesObj)) {
        await supabase
          .from('profiles')
          .upsert(buildProfileRow(userId, clienteData), { onConflict: 'id' });
      }
    } catch (err) {
      console.error('Supabase guardarClientes catch (local backup OK):', err.message);
    }
  }
}

async function eliminarCliente(userId) {
  const key = String(userId);
  const existia = Boolean(clientes[key]);
  delete clientes[key];

  try {
    fs.writeFileSync(CLIENTES_FILE, JSON.stringify(clientes, null, 2));
  } catch (e) {
    console.error('Error guardando clientes tras eliminar:', e.message);
  }

  if (USE_SUPABASE && isAvailable()) {
    try {
      const supabase = getSupabase();
      await supabase.from('profiles').delete().eq('id', parseInt(key, 10));
    } catch (e) {
      console.error('Supabase eliminarCliente error:', e.message);
    }
  }

  return existia;
}

async function getCliente(userId) {
  if (USE_SUPABASE && isAvailable()) {
    const supabase = getSupabase();
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !data) return null;
      return {
        userId: String(data.id),
        sheetId: data.sheet_id,
        email: data.email,
        telegramUserId: data.id,
        usuarios: data.usuarios || [],
      };
    } catch {
      return null;
    }
  }
  return clientes[userId] || null;
}

// initialize on load
(async () => {
  try {
    await cargarClientes();
  } catch (e) {
    console.error('Error inicializando clientes:', e.message);
    cargarClientesLocal();
  }
})();

module.exports = {
  get clientes() { return clientes; },
  set clientes(val) { clientes = val; },
  cargarClientes,
  guardarClientes,
  getCliente,
  eliminarCliente,
};
