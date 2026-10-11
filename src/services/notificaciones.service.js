// Notificaciones web: campanita del dashboard + Web Push (avisos con la web cerrada).
//
// Un aviso hace tres cosas, todas BEST-EFFORT (un fallo nunca rompe la operación que
// lo disparó, p. ej. marcar que llegó un paciente):
//   1. se guarda (Supabase si está la tabla; si no, en memoria, que se pierde en cada deploy),
//   2. se manda por SSE a las pestañas abiertas de esa persona (evento `notificacion`),
//   3. se manda por Web Push a los dispositivos que aceptaron (si hay claves VAPID).
//
// Tablas: sql/migrations/020_notificaciones_web.sql. Claves: VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY y VAPID_SUBJECT (ver README / CLAUDE.md).

require('../config'); // carga el .env
const crypto = require('crypto');
const webpush = require('web-push');
const { forPersona } = require('../lib/persona-db');
const { resolveTenantId } = require('./tenant.service');
const eventsService = require('./events.service');
const logger = require('../lib/logger');

const MAX_NOTIFICACIONES = 30;      // lo que muestra la campanita
const MAX_EN_MEMORIA = 50;
const MAX_SUSCRIPCIONES = 10;       // dispositivos por persona
const DIAS_DE_HISTORIAL = 30;
const REINTENTO_TABLA_MS = 5 * 60 * 1000;
const TTL_PUSH_SEGUNDOS = 60 * 60;  // un aviso de "llegó el paciente" no sirve horas después

const TIPOS = ['llegada_paciente', 'turno_nuevo', 'turno_cancelado', 'turno_no_vino'];

// ── Claves VAPID ─────────────────────────────────────────────────────────────

function configuracionPush() {
  const publica = process.env.VAPID_PUBLIC_KEY || '';
  const privada = process.env.VAPID_PRIVATE_KEY || '';
  const asunto = process.env.VAPID_SUBJECT || '';
  return { publica, privada, asunto, activo: Boolean(publica && privada) };
}

let vapidListo = null;
function vapidConfigurado() {
  const c = configuracionPush();
  if (!c.activo) return false;
  if (vapidListo === `${c.publica}|${c.privada}|${c.asunto}`) return true;
  try {
    // Sin asunto válido (mailto: o https:) web-push rechaza las claves: se usa el del dashboard o un mailto genérico.
    const asunto = /^(mailto:|https:\/\/)/.test(c.asunto) ? c.asunto : 'mailto:soporte@cashy.app';
    webpush.setVapidDetails(asunto, c.publica, c.privada);
    vapidListo = `${c.publica}|${c.privada}|${c.asunto}`;
    return true;
  } catch (err) {
    logger.warn('NOTIF', 'Claves VAPID inválidas: el push queda desactivado', { err: err.message });
    return false;
  }
}

function pushDisponible() { return vapidConfigurado(); }
function clavePublica() { return pushDisponible() ? configuracionPush().publica : null; }

// ── Almacenamiento: Supabase con respaldo en memoria ─────────────────────────

const memoria = new Map(); // userId -> { notificaciones: [], suscripciones: Map(endpoint -> sub) }
function memoriaDe(userId) {
  const k = String(userId);
  if (!memoria.has(k)) memoria.set(k, { notificaciones: [], suscripciones: new Map() });
  return memoria.get(k);
}

let sinTablaHasta = 0;
function tablaFaltante(error) {
  return Boolean(error && /does not exist|could not find|not found|schema cache/i.test(error.message || ''));
}
function avisarTablaFaltante() {
  const primera = sinTablaHasta === 0;
  sinTablaHasta = Date.now() + REINTENTO_TABLA_MS;
  if (primera) {
    logger.warn('NOTIF', 'Faltan las tablas de notificaciones: se guardan en memoria y no hay push entre deploys (correr sql/migrations/020_notificaciones_web.sql)');
  }
}

const perfilesAsegurados = new Set();
// -> forPersona o null (sin Supabase, sin tenant, o tabla faltante hace un rato)
async function personaDe(userId) {
  if (Date.now() < sinTablaHasta) return null;
  try {
    const clave = String(userId);
    if (!perfilesAsegurados.has(clave)) {
      const { ensureProfile } = require('./db.service'); // lazy: evita un ciclo de imports
      await ensureProfile(userId);
      perfilesAsegurados.add(clave);
    }
    const tenantId = await resolveTenantId(userId);
    if (!tenantId) return null;
    return forPersona(tenantId, userId);
  } catch (err) {
    logger.warn('NOTIF', 'No se pudo preparar el acceso a Supabase', { err: err.message });
    return null;
  }
}

// Devuelve true si el error era "tabla faltante" (y ya se avisó), para caer a memoria.
function fallo(error, contexto) {
  if (tablaFaltante(error)) { avisarTablaFaltante(); return true; }
  logger.warn('NOTIF', `Error de Supabase (${contexto})`, { err: error.message });
  return true;
}

function aVista(fila) {
  return {
    id: fila.id,
    tipo: fila.tipo,
    titulo: fila.titulo,
    cuerpo: fila.cuerpo || '',
    url: fila.url || '',
    leida: Boolean(fila.leida),
    creadaEn: fila.created_at || fila.creadaEn,
  };
}

// ── Guardar y listar ─────────────────────────────────────────────────────────

async function guardarNotificacion(userId, notif) {
  const persona = await personaDe(userId);
  if (persona) {
    const { data, error } = await persona
      .from('notificaciones')
      .insert({ tipo: notif.tipo, titulo: notif.titulo, cuerpo: notif.cuerpo || null, url: notif.url || null })
      .select('id, tipo, titulo, cuerpo, url, leida, created_at')
      .single();
    if (!error && data) return aVista(data);
    fallo(error || { message: 'sin datos' }, 'insertar notificación');
  }
  // Memoria
  const m = memoriaDe(userId);
  const vista = { id: crypto.randomUUID(), ...notif, leida: false, creadaEn: new Date().toISOString() };
  m.notificaciones.unshift(vista);
  if (m.notificaciones.length > MAX_EN_MEMORIA) m.notificaciones.length = MAX_EN_MEMORIA;
  return vista;
}

async function listar(userId) {
  const persona = await personaDe(userId);
  if (persona) {
    const desde = new Date(Date.now() - DIAS_DE_HISTORIAL * 24 * 3600 * 1000).toISOString();
    const { data, error } = await persona
      .from('notificaciones')
      .select('id, tipo, titulo, cuerpo, url, leida, created_at')
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(MAX_NOTIFICACIONES);
    if (!error) {
      const lista = (data || []).map(aVista);
      return { notificaciones: lista, noLeidas: lista.filter(n => !n.leida).length };
    }
    fallo(error, 'listar notificaciones');
  }
  const lista = memoriaDe(userId).notificaciones.slice(0, MAX_NOTIFICACIONES);
  return { notificaciones: lista, noLeidas: lista.filter(n => !n.leida).length };
}

async function marcarLeidas(userId) {
  const persona = await personaDe(userId);
  if (persona) {
    const { error } = await persona.from('notificaciones').update({ leida: true }).eq('leida', false);
    if (error) fallo(error, 'marcar leídas');
  }
  for (const n of memoriaDe(userId).notificaciones) n.leida = true;
}

// ── Suscripciones push (un dispositivo = una suscripción) ───────────────────

function suscripcionValida(sub) {
  return Boolean(
    sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000
    && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string'
  );
}

async function guardarSuscripcion(userId, sub, userAgent = '') {
  if (!suscripcionValida(sub)) throw new Error('suscripcion_invalida');
  const persona = await personaDe(userId);
  if (persona) {
    const { error } = await persona.from('push_subscriptions').upsert({
      endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: String(userAgent).slice(0, 200),
    }, { onConflict: 'user_id,endpoint' });
    if (!error) return;
    fallo(error, 'guardar suscripción');
  }
  const m = memoriaDe(userId);
  if (!m.suscripciones.has(sub.endpoint) && m.suscripciones.size >= MAX_SUSCRIPCIONES) {
    m.suscripciones.delete(m.suscripciones.keys().next().value);
  }
  m.suscripciones.set(sub.endpoint, { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
}

async function borrarSuscripcion(userId, endpoint) {
  if (typeof endpoint !== 'string' || !endpoint) return;
  const persona = await personaDe(userId);
  if (persona) {
    const { error } = await persona.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) fallo(error, 'borrar suscripción');
  }
  memoriaDe(userId).suscripciones.delete(endpoint);
}

async function suscripcionesDe(userId) {
  const persona = await personaDe(userId);
  if (persona) {
    const { data, error } = await persona.from('push_subscriptions').select('endpoint, p256dh, auth').limit(MAX_SUSCRIPCIONES);
    if (!error) return (data || []).map(f => ({ endpoint: f.endpoint, keys: { p256dh: f.p256dh, auth: f.auth } }));
    fallo(error, 'leer suscripciones');
  }
  return [...memoriaDe(userId).suscripciones.values()];
}

async function enviarPush(userId, notif) {
  if (!pushDisponible()) return { enviados: 0 };
  const subs = await suscripcionesDe(userId);
  const payload = JSON.stringify({ titulo: notif.titulo, cuerpo: notif.cuerpo, url: notif.url || '/', tag: notif.tipo });
  let enviados = 0;
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, payload, { TTL: TTL_PUSH_SEGUNDOS });
      enviados += 1;
    } catch (err) {
      // 404/410: el navegador ya no existe o se revocó el permiso → se limpia.
      if (err.statusCode === 404 || err.statusCode === 410) await borrarSuscripcion(userId, sub.endpoint);
      else logger.warn('NOTIF', 'Falló un push', { status: err.statusCode, err: String(err.message).slice(0, 120) });
    }
  }));
  return { enviados };
}

// ── API principal ────────────────────────────────────────────────────────────

/**
 * Avisa a UNA persona. Nunca lanza.
 * @param {string|number} userId  ID de la persona (el mismo del bot/dashboard)
 * @param {{tipo:string, titulo:string, cuerpo?:string, url?:string}} aviso
 */
async function notificar(userId, aviso) {
  try {
    if (!userId || !aviso?.titulo || !TIPOS.includes(aviso.tipo)) return { ok: false, error: 'aviso_invalido' };
    const notif = { tipo: aviso.tipo, titulo: String(aviso.titulo).slice(0, 120), cuerpo: String(aviso.cuerpo || '').slice(0, 300), url: aviso.url || '/agenda' };
    const guardada = await guardarNotificacion(userId, notif);
    const web = eventsService.emitNotificacion(userId, guardada);
    const push = await enviarPush(userId, notif);
    return { ok: true, web, push: push.enviados };
  } catch (err) {
    logger.error('NOTIF', 'Error enviando notificación', { err: err.message });
    return { ok: false, error: 'envio_fallido' };
  }
}

const TEXTOS_TURNO = {
  llegada_paciente: '✅ Llegó tu paciente',
  turno_nuevo: '🗓 Turno nuevo',
  turno_cancelado: '❌ Turno cancelado',
  turno_no_vino: '🚫 El paciente no vino',
};

function detalleTurno(turno) {
  return [turno.cliente, turno.hora, turno.servicio].filter(Boolean).join(' · ');
}

/**
 * Avisa al profesional de un turno (si está registrado con /profesional). No avisa a
 * quien hizo el cambio si es el mismo profesional. Nunca lanza.
 */
async function notificarTurno(actorUserId, tipo, turno) {
  try {
    if (!turno?.profesional) return { ok: false, error: 'sin_profesional' };
    const tenantId = await resolveTenantId(actorUserId);
    if (!tenantId) return { ok: false, error: 'tenant_no_resuelto' };
    const { buscarProfesionalPorNombre } = require('./profesional.service'); // lazy
    const profesional = await buscarProfesionalPorNombre(tenantId, turno.profesional);
    if (!profesional?.telegram_user_id) return { ok: false, error: 'profesional_no_encontrado' };
    const destino = String(profesional.telegram_user_id);
    if (destino === String(actorUserId)) return { ok: true, omitido: 'es_quien_lo_hizo' };
    return await notificar(destino, { tipo, titulo: TEXTOS_TURNO[tipo], cuerpo: detalleTurno(turno), url: '/agenda' });
  } catch (err) {
    logger.error('NOTIF', 'Error avisando por un turno', { tipo, err: err.message });
    return { ok: false, error: 'envio_fallido' };
  }
}

module.exports = {
  TIPOS,
  notificar,
  notificarTurno,
  listar,
  marcarLeidas,
  guardarSuscripcion,
  borrarSuscripcion,
  pushDisponible,
  clavePublica,
  suscripcionValida,
  _memoria: memoria, // solo para tests
};
