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
const clienteService = require('../services/cliente.service');
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
  if (pedido.google) return mensajeVinculoGoogle(pedido, ahora);
  return (
    '🔐 *¿Querés entrar al dashboard de Cashy?*\n\n' +
    'Pedido hecho desde:\n' +
    `• 💻 ${escapeMarkdown(pedido.navegador)}\n` +
    `• 🌐 IP ${escapeMarkdown(pedido.ip || 'desconocida')}\n` +
    `• 🕒 ${horaLocal(pedido.creadaEn)} (${haceCuanto(pedido.creadaEn, ahora)})\n\n` +
    'Aprobalo *solo si lo pediste vos ahora*. Si no reconocés este pedido, tocá *No fui yo*.'
  );
}

// Entrar con Google desde una cuenta de Google que todavía no está vinculada: la
// persona confirma acá que ESA cuenta de Google es suya. Es la defensa contra
// alguien que arma un pedido con SU Google y te manda el link: se muestra el email.
function mensajeVinculoGoogle(pedido, ahora = Date.now()) {
  return (
    '🔗 *¿Vincular esta cuenta de Google a tu Cashy?*\n\n' +
    `• 📧 Cuenta de Google: *${escapeMarkdown(pedido.google.email || 'desconocida')}*\n` +
    `• 💻 Pedido desde: ${escapeMarkdown(pedido.navegador)}\n` +
    `• 🌐 IP ${escapeMarkdown(pedido.ip || 'desconocida')}\n` +
    `• 🕒 ${horaLocal(pedido.creadaEn)} (${haceCuanto(pedido.creadaEn, ahora)})\n\n` +
    'Quien entre con esa cuenta de Google va a poder ver *todo lo tuyo* en el dashboard. ' +
    'Aprobalo *solo si esa cuenta es tuya y el pedido lo hiciste vos ahora*. Si no, tocá *No fui yo*.'
  );
}

const MOTIVOS_VINCULO = {
  sub_en_uso: '⚠️ Esa cuenta de Google ya está vinculada a otra persona de Cashy.',
  ya_vinculada_otra: '⚠️ Tu cuenta de Cashy ya tiene otra cuenta de Google vinculada. Usá /google desvincular y volvé a intentar.',
  sin_perfil: '⚠️ No pude preparar tu perfil. Cargá un movimiento y probá de nuevo.',
  no_disponible: '⚠️ El ingreso con Google no está disponible ahora.',
};

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
    // Si el pedido trae una cuenta de Google sin vincular, aprobar = vincularla a
    // quien toca el botón (ctx.from.id), nunca a una identidad que venga del link.
    const pedido = loginTelegram.ID_REGEX.test(String(id || '')) ? loginTelegram.obtenerParaAprobar(id) : null;
    if (!pedido) return ctx.editMessageText(MENSAJE_VENCIDO.replace(/\*/g, ''));
    if (pedido.google) {
      const v = await clienteService.vincularGoogle(userId, pedido.google.sub);
      if (!v.ok) {
        loginTelegram.rechazar(id);
        logger.audit('auth_google_vinculo_rechazado', { loginId: id, userId, motivo: v.motivo });
        return ctx.editMessageText(MOTIVOS_VINCULO[v.motivo] || MOTIVOS_VINCULO.no_disponible);
      }
      logger.audit('auth_google_vinculado', { loginId: id, userId });
    }

    // La identidad es la de quien toca el botón, no la del callback.
    const aprobado = loginTelegram.aprobar(id, userId);
    if (!aprobado) {
      if (pedido.google) await clienteService.desvincularGoogle(userId);
      return ctx.editMessageText(MENSAJE_VENCIDO.replace(/\*/g, ''));
    }
    logger.audit('auth_telegram_login_aprobado', { loginId: id, userId });
    return ctx.editMessageText('✅ Listo, ya podés volver al navegador: va a entrar solo.\n\nSi no fuiste vos, avisá al administrador.');
  }

  const rechazado = loginTelegram.rechazar(id);
  if (!rechazado) return ctx.editMessageText(MENSAJE_VENCIDO.replace(/\*/g, ''));
  logger.audit('auth_telegram_login_rechazado', { loginId: id, userId, motivo: 'rechazado_por_la_persona' });
  return ctx.editMessageText('❌ Pedido rechazado. Tu cuenta sigue segura.');
}

bot.action(/^login_(ok|no):([A-Za-z0-9_-]{22})$/, handleLoginDecision);

module.exports = { iniciarAprobacionLogin, handleLoginDecision, mensajeConfirmacion, mensajeVinculoGoogle, haceCuanto };
