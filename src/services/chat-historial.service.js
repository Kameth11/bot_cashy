// Persistencia del historial del chat web (ver lib/canal-web.js y
// sql/migrations/015_chat_historial.sql): una fila por persona con sus últimos
// mensajes, en Supabase. Todo es BEST-EFFORT: sin Supabase, sin la tabla, o con
// un error, el chat sigue funcionando en memoria (el historial solo se pierde en
// el próximo deploy, que es el comportamiento de antes).

const { forPersona } = require('../lib/persona-db');
const { resolveTenantId } = require('./tenant.service');
const logger = require('../lib/logger');

const REINTENTO_TABLA_MS = 5 * 60 * 1000; // si faltaba la tabla, se vuelve a probar de a ratos

// Se avisa una sola vez si falta la tabla, y mientras tanto no se insiste.
let sinTablaHasta = 0;

function tablaFaltante(error) {
  return Boolean(error && /does not exist|could not find|not found|schema cache/i.test(error.message || ''));
}

function avisarTablaFaltante() {
  const primera = sinTablaHasta === 0;
  sinTablaHasta = Date.now() + REINTENTO_TABLA_MS;
  if (primera) {
    logger.warn('CHAT_WEB', 'Falta la tabla chat_historial: el historial del chat no se guarda entre deploys (correr sql/migrations/015_chat_historial.sql)');
  }
}

// El perfil tiene que existir (FK) y la persona tiene que tener tenant.
const perfilesAsegurados = new Set();

async function dbDe(userId) {
  if (Date.now() < sinTablaHasta) return null;
  const clave = String(userId);
  if (!perfilesAsegurados.has(clave)) {
    const { ensureProfile } = require('./db.service'); // lazy: evita un ciclo de imports
    await ensureProfile(userId);
    perfilesAsegurados.add(clave);
  }
  const tenantId = await resolveTenantId(userId);
  if (!tenantId) return null;
  return { persona: forPersona(tenantId, userId), tenantId };
}

// -> { mensajes, ultimoId, rev } | null (sin Supabase / sin tabla / sin fila / error)
async function cargar(userId) {
  try {
    const ctx = await dbDe(userId);
    if (!ctx || !ctx.persona) return null;
    const { data, error } = await ctx.persona
      .from('chat_historial')
      .select('mensajes, ultimo_id, rev')
      .maybeSingle();
    if (error) {
      if (tablaFaltante(error)) avisarTablaFaltante();
      else logger.warn('CHAT_WEB', 'No se pudo leer el historial del chat', { err: error.message });
      return null;
    }
    if (!data) return null;
    return {
      mensajes: Array.isArray(data.mensajes) ? data.mensajes : [],
      ultimoId: Number(data.ultimo_id) || 0,
      rev: Number(data.rev) || 0,
    };
  } catch (err) {
    logger.warn('CHAT_WEB', 'No se pudo leer el historial del chat', { err: err.message });
    return null;
  }
}

// -> true si se guardó. Nunca lanza.
async function guardar(userId, { mensajes, ultimoId, rev }) {
  try {
    const ctx = await dbDe(userId);
    if (!ctx || !ctx.persona) return false;
    const { error } = await ctx.persona
      .from('chat_historial')
      .upsert({
        tenant_id: ctx.tenantId,
        mensajes,
        ultimo_id: ultimoId,
        rev,
      }, { onConflict: 'user_id' });
    if (error) {
      if (tablaFaltante(error)) avisarTablaFaltante();
      else logger.warn('CHAT_WEB', 'No se pudo guardar el historial del chat', { err: error.message });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('CHAT_WEB', 'No se pudo guardar el historial del chat', { err: err.message });
    return false;
  }
}

function _resetParaTests() {
  sinTablaHasta = 0;
  perfilesAsegurados.clear();
}

module.exports = { cargar, guardar, REINTENTO_TABLA_MS, _resetParaTests };
