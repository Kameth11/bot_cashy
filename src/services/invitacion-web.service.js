// Invitaciones por email: alta de personas al consultorio SIN Telegram.
//
//   1. Quien tiene el permiso `invitar_personas` (el dueño siempre; otros si el dueño se lo
//      asigna en Accesos) invita a un email desde el dashboard, eligiendo permisos y, si
//      quiere, nombre y consultorio como profesional.
//   2. La persona entra con "Entrar con Google" con ese email. Google verifica que es suyo;
//      acá se busca una invitación pendiente para ese email y se le crea la cuenta.
//   3. La cuenta nueva es un invitado más del dueño (mismo Sheet, permisos elegidos) con un
//      ID propio NEGATIVO: no choca con los de Telegram (siempre positivos) y no migra nada.
//
// Reglas de seguridad (cubiertas en tests/invitacion-web.service.test.js):
//   - Solo invita quien tiene `invitar_personas`.
//   - Solo se pueden dar permisos que quien invita TIENE (no se escala privilegio).
//   - `invitar_personas` solo la puede dar el dueño (no se encadena la delegación).
//   - El email NO identifica a nadie por sí solo: hace falta una invitación pendiente, creada
//     a propósito por alguien con permiso, y Google tiene que confirmar que el email es de quien entra.
//   - Una invitación se usa una sola vez (se reclama con un UPDATE condicional, no con un
//     SELECT + UPDATE), vence a los 7 días y se puede revocar.
//   - Todo lo que se lista, crea o revoca se filtra por tenant_id.

const crypto = require('crypto');
const { getSupabase, isAvailable } = require('../lib/supabase');
const { USE_SUPABASE } = require('../config');
const { obtenerClientePorUserId, resolverPermisos, esAdminOriginal } = require('../auth');
const { DEFAULT_PERMISOS, validarPermisos, puede } = require('../auth/permisos');
const { validarEmail } = require('../utils/validation');
const { sanitizarInput } = require('../utils/formatter');
const clienteService = require('./cliente.service');
const { resolveTenantId } = require('./tenant.service');
const logger = require('../lib/logger');
const { logFallo } = require('../lib/errores');

const DIAS_DE_VIGENCIA = 7;
const MAX_PENDIENTES = 25;
const NOMBRE_MIN = 2;
const NOMBRE_MAX = 60;
const CONSULTORIO_MAX = 40;
const PERMISO_INVITAR = 'invitar_personas';

function disponible() {
  return Boolean(USE_SUPABASE && isAvailable() && getSupabase());
}

const ahoraIso = () => new Date().toISOString();

// ID de una cuenta nacida en la web: negativo y único. Date.now()*1000 queda por debajo de
// Number.MAX_SAFE_INTEGER (~9e15) hasta el año 2255, así que es seguro como número y como BIGINT.
function generarIdWeb(clientes) {
  for (let i = 0; i < 10; i++) {
    const id = -(Date.now() * 1000 + crypto.randomInt(0, 1000));
    if (!clientes[String(id)]) return id;
  }
  throw new Error('no_se_pudo_generar_id');
}

// Quién es quien invita y de qué consultorio.
function contextoDe(actorId) {
  const esAdmin = Boolean(esAdminOriginal(actorId));
  const cliente = obtenerClientePorUserId(actorId);
  if (!cliente && !esAdmin) return null;
  const ownerId = String(cliente?.ownerId ?? actorId);
  return {
    actor: String(actorId),
    ownerId,
    esDueno: esAdmin || Boolean(cliente?.isOwner),
    permisos: resolverPermisos(actorId),
  };
}

function vista(fila, actor) {
  const vencida = fila.estado === 'pendiente' && new Date(fila.expira_en).getTime() <= Date.now();
  return {
    id: fila.id,
    email: fila.email,
    permisos: fila.permisos || [],
    profesional: fila.profesional_nombre
      ? { nombre: fila.profesional_nombre, consultorio: fila.profesional_consultorio || null }
      : null,
    estado: vencida ? 'vencida' : fila.estado,
    expiraEn: fila.expira_en,
    creadaEn: fila.created_at,
    esMia: String(fila.creada_por) === String(actor),
  };
}

/**
 * Crea una invitación. Nunca lanza: devuelve { ok:false, error } con un código que la ruta traduce.
 * @param {string|number} actorId  quien invita (sale de la sesión)
 * @param {{email:string, permisos?:string[], profesional?:{nombre?:string, consultorio?:string}}} datos
 */
async function crearInvitacion(actorId, datos = {}) {
  try {
    if (!disponible()) return { ok: false, error: 'sin_base' };
    const ctx = contextoDe(actorId);
    if (!ctx || !puede(ctx.permisos, PERMISO_INVITAR)) return { ok: false, error: 'sin_permiso' };

    const email = validarEmail(datos.email);
    if (!email.ok) return { ok: false, error: 'email_invalido' };

    // Permisos: vacío = el mínimo; nunca más de lo que quien invita tiene, y la delegación
    // de invitar solo la da el dueño.
    const pedidos = Array.isArray(datos.permisos) && datos.permisos.length ? [...new Set(datos.permisos)] : [...DEFAULT_PERMISOS];
    if (!validarPermisos(pedidos)) return { ok: false, error: 'permisos_invalidos' };
    if (pedidos.includes(PERMISO_INVITAR) && !ctx.esDueno) return { ok: false, error: 'delegacion_no_permitida' };
    if (!ctx.esDueno && pedidos.some(p => !puede(ctx.permisos, p))) return { ok: false, error: 'permisos_excedidos' };

    const tenantId = await resolveTenantId(ctx.actor);
    if (!tenantId) return { ok: false, error: 'sin_base' };

    // Alguien que ya es del consultorio no necesita invitación.
    const clientes = clienteService.clientes;
    const owner = clientes[ctx.ownerId];
    const idsMiembros = [ctx.ownerId, ...((owner?.usuarios || []).map(String))];
    if (idsMiembros.some(id => String(clientes[id]?.email || '').toLowerCase() === email.valor)) {
      return { ok: false, error: 'ya_miembro' };
    }

    // Profesional opcional.
    let profNombre = null;
    let profConsultorio = null;
    const prof = datos.profesional;
    if (prof && (prof.nombre || prof.consultorio)) {
      profNombre = sanitizarInput(prof.nombre, NOMBRE_MAX).trim();
      if (profNombre.length < NOMBRE_MIN) return { ok: false, error: 'profesional_nombre_invalido' };
      const crudo = String(prof.consultorio ?? '').trim();
      profConsultorio = !crudo || /^(ninguno|no|-)$/i.test(crudo) ? null : (sanitizarInput(crudo, CONSULTORIO_MAX).trim() || null);

      const profesionales = require('./profesional.service');
      const normal = profesionales.normalizarNombreProfesional(profNombre);
      const existentes = await profesionales.listarProfesionales(tenantId);
      if (existentes.some(p => profesionales.normalizarNombreProfesional(p.nombre) === normal)) {
        return { ok: false, error: 'profesional_duplicado' };
      }
    }

    const sb = getSupabase();

    // Las vencidas no cuentan, y no deben bloquear una invitación nueva al mismo email.
    await sb.from('invitaciones_web').update({ estado: 'revocada' })
      .eq('tenant_id', tenantId).eq('estado', 'pendiente').lt('expira_en', ahoraIso());

    const { count } = await sb.from('invitaciones_web').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('estado', 'pendiente');
    if ((count || 0) >= MAX_PENDIENTES) return { ok: false, error: 'limite_pendientes' };

    const { data, error } = await sb.from('invitaciones_web').insert({
      tenant_id: tenantId,
      owner_id: Number(ctx.ownerId),
      email: email.valor,
      permisos: pedidos,
      profesional_nombre: profNombre,
      profesional_consultorio: profConsultorio,
      creada_por: Number(ctx.actor),
      expira_en: new Date(Date.now() + DIAS_DE_VIGENCIA * 24 * 3600 * 1000).toISOString(),
    }).select('*').single();

    if (error) {
      if (error.code === '23505') return { ok: false, error: 'ya_invitado' };
      logger.error('INVITACION', 'No se pudo crear la invitación', { err: error.message });
      return { ok: false, error: 'error_interno' };
    }

    logger.audit('invitacion_web_creada', { actor: ctx.actor, ownerId: ctx.ownerId, email: email.valor, permisos: pedidos, profesional: Boolean(profNombre) });
    return { ok: true, invitacion: vista(data, ctx.actor) };
  } catch (err) {
    logger.error('INVITACION', 'Error creando invitación', { err: err.message });
    return { ok: false, error: 'error_interno' };
  }
}

/** Invitaciones del consultorio: el dueño ve todas; el resto, solo las que creó. */
async function listarInvitaciones(actorId) {
  if (!disponible()) return { ok: false, error: 'sin_base' };
  const ctx = contextoDe(actorId);
  if (!ctx || !puede(ctx.permisos, PERMISO_INVITAR)) return { ok: false, error: 'sin_permiso' };
  const tenantId = await resolveTenantId(ctx.actor);
  if (!tenantId) return { ok: false, error: 'sin_base' };

  let consulta = getSupabase().from('invitaciones_web').select('*').eq('tenant_id', tenantId);
  if (!ctx.esDueno) consulta = consulta.eq('creada_por', Number(ctx.actor));
  const { data, error } = await consulta.order('created_at', { ascending: false }).limit(50);
  if (error) {
    logger.error('INVITACION', 'No se pudieron listar las invitaciones', { err: error.message });
    return { ok: false, error: 'error_interno' };
  }
  return { ok: true, invitaciones: (data || []).map(f => vista(f, ctx.actor)) };
}

/** Revoca una invitación pendiente: la puede revocar quien la creó o el dueño. */
async function revocarInvitacion(actorId, id) {
  if (!disponible()) return { ok: false, error: 'sin_base' };
  const ctx = contextoDe(actorId);
  if (!ctx || !puede(ctx.permisos, PERMISO_INVITAR)) return { ok: false, error: 'sin_permiso' };
  const tenantId = await resolveTenantId(ctx.actor);
  if (!tenantId) return { ok: false, error: 'sin_base' };

  let consulta = getSupabase().from('invitaciones_web').update({ estado: 'revocada' })
    .eq('id', String(id)).eq('tenant_id', tenantId).eq('estado', 'pendiente');
  if (!ctx.esDueno) consulta = consulta.eq('creada_por', Number(ctx.actor));
  const { data, error } = await consulta.select('id');
  if (error) {
    logger.error('INVITACION', 'No se pudo revocar la invitación', { err: error.message });
    return { ok: false, error: 'error_interno' };
  }
  if (!data || data.length === 0) return { ok: false, error: 'no_encontrada' };
  logger.audit('invitacion_web_revocada', { actor: ctx.actor, id: String(id) });
  return { ok: true };
}

/** Invitación pendiente y vigente para un email (más antigua primero), o null. */
async function buscarPendientePorEmail(email) {
  if (!disponible()) return null;
  const normal = validarEmail(email);
  if (!normal.ok) return null;
  const { data, error } = await getSupabase().from('invitaciones_web').select('*')
    .eq('email', normal.valor).eq('estado', 'pendiente').gt('expira_en', ahoraIso())
    .order('created_at', { ascending: true }).limit(1);
  if (error) {
    logger.error('INVITACION', 'No se pudo buscar la invitación', { err: error.message });
    return null;
  }
  return data && data[0] ? data[0] : null;
}

/**
 * Canje al entrar con Google. `g` es lo que verificó Google ({sub, email, nombre}); el email YA
 * está verificado. Si hay una invitación pendiente para ese email, crea la cuenta.
 * @returns {Promise<{ok:true, userId:string, ownerId:string} | {ok:false, motivo:string}>}
 */
async function canjearPorGoogle(g) {
  const sb = disponible() ? getSupabase() : null;
  if (!sb || !g?.sub || !g?.email) return { ok: false, motivo: 'sin_invitacion' };
  if (!clienteService.googleSoportado()) return { ok: false, motivo: 'no_disponible' };

  const inv = await buscarPendientePorEmail(g.email);
  if (!inv) return { ok: false, motivo: 'sin_invitacion' };

  const clientes = clienteService.clientes;
  const ownerKey = String(inv.owner_id);
  const owner = clientes[ownerKey];
  if (!owner) {
    logger.warn('INVITACION', 'La invitación apunta a un dueño que ya no existe', { id: inv.id });
    return { ok: false, motivo: 'dueno_inexistente' };
  }

  // Se reclama ANTES de crear nada, con un UPDATE condicional: dos pedidos a la vez no pueden
  // usarla los dos (el segundo no encuentra una fila 'pendiente' y se va).
  const { data: reclamada, error: errorReclamo } = await sb.from('invitaciones_web')
    .update({ estado: 'usada', usada_en: ahoraIso() })
    .eq('id', inv.id).eq('estado', 'pendiente').gt('expira_en', ahoraIso())
    .select('id');
  if (errorReclamo || !reclamada || reclamada.length === 0) return { ok: false, motivo: 'ya_usada' };

  const nuevoId = generarIdWeb(clientes);
  const key = String(nuevoId);
  const usuariosAntes = owner.usuarios;
  const permisosAntes = owner.permisos;

  try {
    clientes[key] = {
      email: g.email,
      display_name: g.nombre || g.email.split('@')[0],
      sheetId: owner.sheetId || null, // mismo Sheet que el dueño, como cualquier invitado
      usuarios: [],
      permisos: {},
      googleSub: g.sub,
      creadoEn: ahoraIso(),
    };
    owner.usuarios = [...(owner.usuarios || []), nuevoId];
    owner.permisos = { ...(owner.permisos || {}), [key]: inv.permisos && inv.permisos.length ? inv.permisos : DEFAULT_PERMISOS };
    await clienteService.guardarClientes(clientes, [ownerKey, key]);
  } catch (err) {
    // No quedó cuenta: se deshace todo y la invitación vuelve a estar disponible.
    delete clientes[key];
    owner.usuarios = usuariosAntes;
    owner.permisos = permisosAntes;
    await sb.from('invitaciones_web').update({ estado: 'pendiente', usada_en: null }).eq('id', inv.id);
    logger.error('INVITACION', 'No se pudo crear la cuenta del invitado', { err: err.message });
    return { ok: false, motivo: 'error_interno' };
  }

  await sb.from('invitaciones_web').update({ usada_por: nuevoId }).eq('id', inv.id);

  // Profesional: opcional y best-effort (la cuenta ya existe; si falla, se registra a mano en Config).
  if (inv.profesional_nombre) {
    try {
      const profesionales = require('./profesional.service');
      const r = await profesionales.registrarProfesional(inv.tenant_id, nuevoId, inv.profesional_nombre, inv.profesional_consultorio || null);
      if (r.ok) require('./agenda.service').invalidarConsultorioMap(inv.tenant_id);
      else logger.warn('INVITACION', 'No se pudo registrar al profesional invitado', { err: r.error });
    } catch (err) {
      logFallo('INVITACION', 'Error registrando al profesional invitado', err);
    }
  }

  logger.audit('invitacion_web_canjeada', { id: inv.id, userId: key, ownerId: ownerKey, creadaPor: String(inv.creada_por) });
  return { ok: true, userId: key, ownerId: ownerKey };
}

module.exports = {
  PERMISO_INVITAR,
  DIAS_DE_VIGENCIA,
  MAX_PENDIENTES,
  disponible,
  crearInvitacion,
  listarInvitaciones,
  revocarInvitacion,
  buscarPendientePorEmail,
  canjearPorGoogle,
  _generarIdWeb: generarIdWeb, // solo para tests
};
