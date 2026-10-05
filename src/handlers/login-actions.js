// Aprobación del login "Entrar con Telegram" desde el bot.
//
// Flujo: la persona abre t.me/<bot>?start=login_<id> -> /start login_<id> ->
// iniciarAprobacionLogin le muestra desde dónde se pidió el ingreso con dos botones
// -> al tocar "Sí, soy yo" se aprueba y el navegador (que está esperando) entra.
//
// La identidad que se aprueba es SIEMPRE ctx.from.id de quien toca el botón:
// nunca algo que venga en el link o en el callback. La confirmación es obligatoria
// y muestra IP y navegador, que es la defensa contra alguien que te manda SU link.

const { Markup } = require('telegraf');
const { bot } = require('../lib/telegraf');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const loginTelegram = require('../services/login-telegram.service');
const { escapeMarkdown } = require('../utils/formatter');
const logger = require('../lib/logger');

const MENSAJE_VENCIDO = '⚠️ Este pedido venció o ya se usó.\n\nVolvé al navegador y tocá *Entrar con Telegram* de nuevo.';
const MENSAJE_NO_REGISTRADO = '⚠️ Tu cuenta todavía no está registrada en Cashy, así que no puedo darte acceso al dashboard.\n\nUsá /start para registrarte.';

function estaRegistrado(userId) {
  return Boolean(esAdminOriginal(userId) || obtenerClientePorUserId(userId));
}

const esChatPrivado = (ctx) => !ctx.chat || ctx.chat.type === 'private';

function haceCuanto(creadaEn, ahora = Date.now()) {
  const seg = Math.max(0, Math.round((ahora - creadaEn) / 1000));
  if (seg < 60) return `hace ${seg} s`;
  return `hace ${Math.round(seg / 60)} min`;
}

function horaLocal(ms) {
  return new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
}

function mensajeConfirmacion(pedido, ahora = Date.now()) {
  return (
    '🔐 *¿Querés entrar al dashboard de Cashy?*\n\n' +
    'Pedido hecho desde:\n' +
    `• 💻 ${escapeMarkdown(pedido.navegador)}\n` +
    `• 🌐 IP ${escapeMarkdown(pedido.ip || 'desconocida')}\n` +
    `• 🕒 ${horaLocal(pedido.creadaEn)} (${haceCuanto(pedido.creadaEn, ahora)})\n\n` +
    'Aprobalo *solo si lo pediste vos ahora*. Si no reconocés este pedido, tocá *No fui yo*.'
  );
}

/**
 * Se llama desde /start cuando el payload es login_<id>. NO toca el estado del
 * registro de usuarios: un /start con payload de login nunca inicia un alta.
 */
async function iniciarAprobacionLogin(ctx, id) {
  const userId = ctx.from.id;

  // La aprobación solo vale en el chat privado con la persona (no en grupos).
  if (!esChatPrivado(ctx)) {
    return ctx.reply('🔒 Abrí este enlace en una conversación privada conmigo para entrar al dashboard.');
  }

  if (!estaRegistrado(userId)) {
    logger.audit('auth_telegram_login_no_registrado', { userId });
    return ctx.reply(MENSAJE_NO_REGISTRADO);
  }

  const pedido = loginTelegram.ID_REGEX.test(String(id || '')) ? loginTelegram.obtenerParaAprobar(id) : null;
  if (!pedido) return ctx.reply(MENSAJE_VENCIDO, { parse_mode: 'Markdown' });

  return ctx.reply(mensajeConfirmacion(pedido), {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[
      Markup.button.callback('✅ Sí, soy yo', `login_ok:${id}`),
      Markup.button.callback('❌ No fui yo', `login_no:${id}`),
    ]]),
  });
}

async function handleLoginDecision(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const [, decision, id] = ctx.match;

  if (!esChatPrivado(ctx) || !estaRegistrado(userId)) {
    return ctx.editMessageText(MENSAJE_NO_REGISTRADO.replace(/\*/g, '')).catch(() => {});
  }

  if (decision === 'ok') {
    // La identidad es la de quien toca el botón, no la del callback.
    const aprobado = loginTelegram.aprobar(id, userId);
    if (!aprobado) return ctx.editMessageText(MENSAJE_VENCIDO.replace(/\*/g, ''));
    logger.audit('auth_telegram_login_aprobado', { loginId: id, userId });
    return ctx.editMessageText('✅ Listo, ya podés volver al navegador: va a entrar solo.\n\nSi no fuiste vos, avisá al administrador.');
  }

  const rechazado = loginTelegram.rechazar(id);
  if (!rechazado) return ctx.editMessageText(MENSAJE_VENCIDO.replace(/\*/g, ''));
  logger.audit('auth_telegram_login_rechazado', { loginId: id, userId, motivo: 'rechazado_por_la_persona' });
  return ctx.editMessageText('❌ Pedido rechazado. Tu cuenta sigue segura.');
}

bot.action(/^login_(ok|no):([A-Za-z0-9_-]{22})$/, handleLoginDecision);

module.exports = { iniciarAprobacionLogin, handleLoginDecision, mensajeConfirmacion, haceCuanto };
