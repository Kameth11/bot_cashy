const fs = require('fs');
const { CLIENTES_FILE, USE_SUPABASE } = require('../config');
const { getSupabase, isAvailable } = require('../lib/supabase');
const { DEFAULT_PERMISOS, ADMIN_PERMISOS, validarPermisos } = require('../auth/permisos');

let clientes = {};

// Serializa escrituras a clientes.json/Supabase para evitar que dos
// registros concurrentes pisen el archivo con datos desactualizados.
let writeQueue = Promise.resolve();

function encolarEscritura(fn) {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.catch(() => {});
  return result;
}

function buildProfileRow(userId, clienteData = {}) {
  return {
    id: parseInt(userId, 10),
    web_user_id: clienteData.webUserId || null,
    email: clienteData.email || null,
    display_name: clienteData.display_name || (clienteData.email ? clienteData.email.split('@')[0] : null),
    sheet_id: clienteData.sheetId || null,
    plan: clienteData.plan || 'free',
    usuarios: Array.isArray(clienteData.usuarios) ? clienteData.usuarios : [],
    permisos: clienteData.permisos && typeof clienteData.permisos === 'object' ? clienteData.permisos : {},
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
          permisos: profile.permisos || {},
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

  return encolarEscritura(async () => {
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
  });
}

async function eliminarCliente(userId) {
  const key = String(userId);
  const existia = Boolean(clientes[key]);
  delete clientes[key];

  return encolarEscritura(async () => {
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
  });
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
        permisos: data.permisos || {},
      };
    } catch {
      return null;
    }
  }
  return clientes[userId] || null;
}

// Devuelve los permisos de un invitado dentro del consultorio de ownerUserId.
// Si el invitado no tiene permisos asignados, devuelve DEFAULT_PERMISOS.
async function getPermisos(ownerUserId, guestUserId) {
  const ownerKey = String(ownerUserId);
  const guestKey = String(guestUserId);

  if (USE_SUPABASE && isAvailable()) {
    try {
      const { data } = await getSupabase()
        .from('profiles')
        .select('permisos')
        .eq('id', parseInt(ownerKey, 10))
        .single();
      if (data?.permisos) return data.permisos[guestKey] || DEFAULT_PERMISOS;
    } catch { /* fallthrough to in-memory */ }
  }
  const owner = clientes[ownerKey];
  if (!owner) return DEFAULT_PERMISOS;
  return (owner.permisos || {})[guestKey] || DEFAULT_PERMISOS;
}

// Actualiza los permisos de un invitado dentro del consultorio de ownerUserId.
// permisosArray debe ser un subset validado de PERMISOS.
async function setPermisos(ownerUserId, guestUserId, permisosArray) {
  const ownerKey = String(ownerUserId);
  const guestKey = String(guestUserId);

  if (!validarPermisos(permisosArray)) throw new Error('Permisos inválidos');

  // Actualizar en memoria
  if (!clientes[ownerKey]) throw new Error('Dueño no encontrado');
  if (!clientes[ownerKey].permisos) clientes[ownerKey].permisos = {};
  clientes[ownerKey].permisos[guestKey] = permisosArray;

  // Persistir en Supabase (update puntual, no reescribe todo)
  if (USE_SUPABASE && isAvailable()) {
    try {
      const nuevoMapa = { ...clientes[ownerKey].permisos };
      await getSupabase()
        .from('profiles')
        .update({ permisos: nuevoMapa })
        .eq('id', parseInt(ownerKey, 10));
    } catch (err) {
      console.error('Supabase setPermisos error (clientes.json actualizado igual):', err.message);
    }
  }

  // Persistir en clientes.json (siempre, como respaldo)
  return encolarEscritura(async () => {
    try {
      fs.writeFileSync(CLIENTES_FILE, JSON.stringify(clientes, null, 2));
    } catch (e) {
      console.error('Error guardando clientes.json en setPermisos:', e.message);
    }
  });
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
  getPermisos,
  setPermisos,
};
