// Fallos del dual-write Supabase <-> Sheets. Antes quedaban solo en console.error y
// nadie se enteraba de que las dos copias se estaban desviando (PLAN_BASE_DE_DATOS.md,
// fase 3). Acá se cuentan, se guardan los últimos con contexto y, si se acumulan, se
// avisa al admin por Telegram (como mucho una vez por hora).
const logger = require('../lib/logger');
const { AUTHORIZED_USER_ID } = require('../config');

const VENTANA_MS = 60 * 60 * 1000;
const UMBRAL_AVISO = 3;
const MAX_GUARDADOS = 20;

const recientes = []; // { ts, tipo, userId, mensaje }
let totalDesdeArranque = 0;
let ultimoAviso = 0;

function registrar(tipo, userId, err) {
  const mensaje = String((err && err.message) || err || 'error desconocido').slice(0, 200);
  totalDesdeArranque++;
  recientes.push({ ts: Date.now(), tipo, userId: userId == null ? null : String(userId), mensaje });
  if (recientes.length > MAX_GUARDADOS) recientes.shift();
  logger.warn('DUAL_WRITE', `Falló ${tipo}: las copias pueden estar desviadas (corré /reconciliar)`, { userId, err: mensaje });
  avisarSiCorresponde();
}

function enVentana(ahora = Date.now()) {
  return recientes.filter(f => ahora - f.ts < VENTANA_MS);
}

function avisarSiCorresponde(ahora = Date.now()) {
  if (!AUTHORIZED_USER_ID) return false;
  const lista = enVentana(ahora);
  if (lista.length < UMBRAL_AVISO || ahora - ultimoAviso < VENTANA_MS) return false;
  ultimoAviso = ahora;
  const texto =
    `⚠️ ${lista.length} escrituras fallaron en la última hora entre Supabase y Google Sheets.\n` +
    `Las dos copias pueden haber quedado distintas. Corré /reconciliar para ver las diferencias.\n\n` +
    `Último error: ${lista[lista.length - 1].tipo} — ${lista[lista.length - 1].mensaje}`;
  try {
    const { bot } = require('../lib/telegraf');
    bot.telegram.sendMessage(AUTHORIZED_USER_ID, texto).catch(e =>
      logger.warn('DUAL_WRITE', 'No se pudo avisar al admin', { err: e.message }));
  } catch (e) {
    logger.warn('DUAL_WRITE', 'No se pudo avisar al admin', { err: e.message });
  }
  return true;
}

function resumen(ahora = Date.now()) {
  return { totalDesdeArranque, ultimaHora: enVentana(ahora).length, ultimos: recientes.slice(-5) };
}

function _reiniciar() {
  recientes.length = 0;
  totalDesdeArranque = 0;
  ultimoAviso = 0;
}

module.exports = { registrar, resumen, avisarSiCorresponde, _reiniciar };
