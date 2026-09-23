const fs = require('fs');
const { CLIENTES_FILE, USE_SUPABASE } = require('../config');
const { getSupabase, isAvailable } = require('../lib/supabase');
const { DEFAULT_PERMISOS, ADMIN_PERMISOS, validarPermisos } = require('../auth/permisos');
const { resolveOrCreateTenantId } = require('./tenant-provisioning.service');

let clientes = {};

// Serializa escrituras a clientes.json/Supabase para evitar que dos
// registros concurrentes pisen el archivo con datos desactualizados.
let writeQueue = Promise.resolve();

function encolarEscritura(fn) {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.catch(() => {});
  return result;
}

// tenantId puede venir null (no se pudo resolver/crear el tenant): en ese
// caso se omite `tenant_id` del row en vez de mandar `null` — profiles.tenant_id
// es NOT NULL (migración 003), así que un `null` explícito rompe tanto el
// insert de una fila nueva como, si alguna vez se relajara el default,
// pisaría el tenant_id ya asignado de una fila existente.
function buildProfileRow(userId, clienteData = {}, tenantId = null) {
  const row = {
    id: parseInt(userId, 10),
    web_user_id: clienteData.webUserId || null,
    email: clienteData.email || null,
    display_name: clienteData.display_name || (clienteData.email ? clienteData.email.split('@')[0] : null),
    sheet_id: clienteData.sheetId || null,
    plan: clienteData.plan || 'free',
    usuarios: Array.isArray(clienteData.usuarios) ? clienteData.usuarios : [],
    permisos: clienteData.permisos && typeof clienteData.permisos === 'object' ? clienteData.permisos : {},
  };
  if (tenantId) row.tenant_id = tenantId;
  return row;
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

// Sube a Supabase el/los perfiles indicados en `changedUserIds` (un array de
// keys de `clientesObj`, o null para sincronizar TODOS — solo tiene sentido
// para el seed inicial cuando Supabase está vacío, ver cargarClientes). Cada
// fila nueva necesita un tenant_id resuelto porque profiles.tenant_id es
// NOT NULL (migración 003); antes buildProfileRow no lo incluía nunca, así
// que el insert de cualquier perfil nuevo fallaba por constraint violation
// — y como supabase-js devuelve el error en vez de lanzarlo, y esto estaba
// en un try/catch que solo atrapa excepciones reales, la falla era 100%
// silenciosa (el usuario quedaba sin fila en Supabase sin ningún log).
async function sincronizarPerfilesConSupabase(clientesObj, changedUserIds) {
  if (!USE_SUPABASE || !isAvailable()) return;

  const supabase = getSupabase();
  const ids = changedUserIds || Object.keys(clientesObj);

  for (const userId of ids) {
    const clienteData = clientesObj[userId];
    if (!clienteData) continue;

    try {
      const tenantId = await resolveOrCreateTenantId(supabase, clienteData.sheetId);
      const { error } = await supabase
        .from('profiles')
        .upsert(buildProfileRow(userId, clienteData, tenantId), { onConflict: 'id' });

      if (error) {
        console.error(`Supabase guardarClientes upsert error (userId=${userId}):`, error.message);
      }
    } catch (err) {
      console.error(`Supabase guardarClientes catch (userId=${userId}, local backup OK):`, err.message);
    }
  }
}

// changedUserIds: key (o array de keys) de clientesObj que efectivamente
// cambiaron. Con eso alcanza para sincronizar Supabase — evita reescribir
// TODOS los perfiles (con sus resoluciones de tenant_id) en cada guardado.
// Se omite (null) solo para el seed inicial de cargarClientes.
async function guardarClientes(clientesObj, changedUserIds = null) {
  clientes = clientesObj;
  const ids = changedUserIds == null ? null
    : Array.isArray(changedUserIds) ? changedUserIds.map(String)
    : [String(changedUserIds)];

  return encolarEscritura(async () => {
    // always save locally as backup
    try {
      fs.writeFileSync(CLIENTES_FILE, JSON.stringify(clientesObj, null, 2));
    } catch (error) {
      console.error('Error al guardar clientes local:', error.message);
    }

    await sincronizarPerfilesConSupabase(clientesObj, ids);
  });
}

async function eliminarCliente(userId) {
  const key = String(userId);
  const numId = Number(userId);
  let existia = Boolean(clientes[key]);
  delete clientes[key];

  // Un invitado no tiene registro propio (ver src/auth/index.js) — sacarlo
  // acá solo borraría un `clientes[key]` que nunca existió y /salir quedaría
  // "sin efecto" en los hechos: hay que sacarlo también de usuarios[] de
  // cualquier dueño donde figure, si no conserva el acceso.
  const ownersActualizados = [];
  for (const [ownerId, cliente] of Object.entries(clientes)) {
    if (!Array.isArray(cliente.usuarios) || cliente.usuarios.length === 0) continue;
    const antes = cliente.usuarios.length;
    cliente.usuarios = cliente.usuarios.filter(u => String(u) !== key && Number(u) !== numId);
    if (cliente.usuarios.length !== antes) {
      existia = true;
      ownersActualizados.push(ownerId);
    }
  }

  return encolarEscritura(async () => {
    try {
      fs.writeFileSync(CLIENTES_FILE, JSON.stringify(clientes, null, 2));
    } catch (e) {
      console.error('Error guardando clientes tras eliminar:', e.message);
    }

    if (USE_SUPABASE && isAvailable()) {
      try {
        const supabase = getSupabase();
        const { error: deleteError } = await supabase.from('profiles').delete().eq('id', parseInt(key, 10));
        if (deleteError) {
          console.error(`Supabase eliminarCliente delete error (userId=${key}):`, deleteError.message);
        }
        for (const ownerId of ownersActualizados) {
          const { error: updateError } = await supabase
            .from('profiles')
            .update({ usuarios: clientes[ownerId].usuarios })
            .eq('id', parseInt(ownerId, 10));
          if (updateError) {
            console.error(`Supabase eliminarCliente usuarios[] update error (ownerId=${ownerId}):`, updateError.message);
          }
        }
      } catch (e) {
        console.error('Supabase eliminarCliente catch (local backup OK):', e.message);
      }
    }

    return existia;
  });
}

// Nota: modoFullIA solo persiste de forma confiable en clientes.json local.
// Si USE_SUPABASE=true, buildProfileRow no lo incluye (la tabla profiles no
// tiene esa columna), así que no sobrevive a un restart con Supabase como
// fuente de verdad — requeriría una migración SQL para agregarla.
async function setModoFullIA(ownerId, enabled) {
  const key = String(ownerId);
  if (!clientes[key]) return false;

  clientes[key] = { ...clientes[key], modoFullIA: Boolean(enabled) };
  await guardarClientes(clientes, key);
  return true;
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
      const { error } = await getSupabase()
        .from('profiles')
        .update({ permisos: nuevoMapa })
        .eq('id', parseInt(ownerKey, 10));
      if (error) {
        console.error(`Supabase setPermisos update error (ownerId=${ownerKey}, clientes.json actualizado igual):`, error.message);
      }
    } catch (err) {
      console.error('Supabase setPermisos catch (clientes.json actualizado igual):', err.message);
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
  setModoFullIA,
  getPermisos,
  setPermisos,
  buildProfileRow,
};
