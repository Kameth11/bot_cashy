// Vincular el Telegram de una persona a su cuenta nacida en la web (invitación por email).
//
// Flujo: en el dashboard toca "Vincular Telegram" -> abre t.me/<bot>?start=vincular_<token> ->
// /start vincular_<token> -> acá se le muestra QUÉ cuenta va a vincular y se le pide confirmar ->
// al tocar "Sí", ESE Telegram queda ligado a la cuenta.
//
// La identidad que se vincula es SIEMPRE la de quien toca el botón (el Telegram real, no un dato del
// link). La confirmación muestra el email de la cuenta y advierte "solo si pediste esto vos ahora":
// es la defensa contra alguien que te manda SU link para que tu Telegram quede atado a SU cuenta.
//
// El Telegram real puede diferir de ctx.from.id: si ese Telegram ya está vinculado, el middleware
// (handlers/middleware.js) reemplaza ctx.from.id por el de la cuenta y deja el real en ctx.state.telegramId.

const { Markup } = require('telegraf');
const { bot } = require('../lib/telegraf');
const { esAdminOriginal } = require('../auth');
const clienteService = require('../services/cliente.service');
const vinculo = require('../services/vinculo-telegram.service');
const { escapeMarkdown } = require('../utils/formatter');
const logger = require('../lib/logger');

const MENSAJE_VENCIDO = '⚠️ Este pedido venció o ya se usó.\n\nVolvé al dashboard (Configuración → General) y tocá *Vincular Telegram* de nuevo.';
const MOTIVOS = {
  telegram_con_cuenta: '⚠️ Este Telegram ya tiene su propia cuenta de Cashy, así que no se puede vincular a otra. Si querés usar la cuenta del dashboard, pedile al dueño que te saque de la otra o que te invite con otro Gmail.',
  telegram_en_uso: '⚠️ Este Telegram ya está vinculado a otra cuenta de Cashy.',
  ya_vinculada_otra: '⚠️ Esa cuenta ya tiene otro Telegram vinculado. Desvinculalo desde el dashboard y volvé a intentar.',
  sin_perfil: '⚠️ No encontré esa cuenta. Pedí el vínculo de nuevo desde el dashboard.',
  no_aplica: '⚠️ Esa cuenta ya es una cuenta de Telegram: no hace falta vincular nada.',
  no_disponible: '⚠️ Vincular Telegram no está disponible ahora.',
};
const textos = require('../messages');

const esChatPrivado = (ctx) => !ctx.chat || ctx.chat.type === 'private';

// El Telegram de verdad de quien escribe (ver el middleware).
const telegramRealDe = (ctx) => Number((ctx.state && ctx.state.telegramId) || ctx.from.id);

function horaLocal(ms) {
  return new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
}

// ¿Este Telegram puede vincularse? -> null si sí, o el mensaje de por qué no.
function impedimento(telegramId, userIdDestino) {
  const yaVinculadoA = clienteService.cuentaPorTelegramId(telegramId);
  if (yaVinculadoA) {
    return yaVinculadoA === String(userIdDestino)
      ? '✅ Este Telegram ya está vinculado a esa cuenta. No hace falta hacer nada más.'
      : MOTIVOS.telegram_en_uso;
  }
  if (esAdminOriginal(telegramId) || clienteService.telegramYaTieneCuenta(telegramId)) return MOTIVOS.telegram_con_cuenta;
  return null;
}

/** Se llama desde /start cuando el payload es vincular_<token>. Nunca inicia un alta de usuario. */
async function iniciarVinculo(ctx, token) {
  if (!esChatPrivado(ctx)) {
    return ctx.reply(textos.vinculoTelegram.abriEsteEnlaceEnUna);
  }

  const pedido = vinculo.obtenerPedido(token);
  if (!pedido) return ctx.reply(MENSAJE_VENCIDO, { parse_mode: 'Markdown' });

  const telegramId = telegramRealDe(ctx);
  const problema = impedimento(telegramId, pedido.userId);
  if (problema) {
    logger.audit('telegram_vinculo_impedido', { telegramId, userId: pedido.userId });
    return ctx.reply(problema);
  }

  const cuenta = clienteService.clientes[pedido.userId];
  const email = cuenta?.email || 'una cuenta del dashboard';

  return ctx.reply(
    '🔗 *¿Vincular este Telegram a tu cuenta de Cashy?*\n\n' +
    `• 📧 Cuenta: *${escapeMarkdown(email)}*\n` +
    `• 🕒 Pedido hecho a las ${horaLocal(pedido.creadaEn)}\n\n` +
    'Desde ahora vas a poder usar el bot con esa cuenta y vas a recibir los avisos acá. ' +
    'Aprobalo *solo si pediste esto vos, ahora, desde el dashboard*. Si no, tocá *No fui yo*.',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[
        Markup.button.callback(textos.vinculoTelegram.siVincular, `vinculo_ok:${token}`),
        Markup.button.callback(textos.vinculoTelegram.noFuiYo, `vinculo_no:${token}`),
      ]]),
    }
  );
}

async function handleVinculoDecision(ctx) {
  await ctx.answerCbQuery();
  const [, decision, token] = ctx.match;

  if (!esChatPrivado(ctx)) return ctx.editMessageText(textos.vinculoTelegram.estoSoloSePuedeConfirmar).catch(() => {});

  const pedido = vinculo.obtenerPedido(token);
  if (!pedido) return ctx.editMessageText(MENSAJE_VENCIDO.replace(/\*/g, '')).catch(() => {});

  if (decision === 'no') {
    vinculo.consumir(token);
    logger.audit('telegram_vinculo_rechazado', { telegramId: telegramRealDe(ctx), userId: pedido.userId });
    return ctx.editMessageText(textos.vinculoTelegram.pedidoRechazadoNoSeVinculo).catch(() => {});
  }

  const telegramId = telegramRealDe(ctx);
  const problema = impedimento(telegramId, pedido.userId);
  if (problema) {
    vinculo.consumir(token);
    return ctx.editMessageText(problema).catch(() => {});
  }

  // Quien toca "Sí" es el Telegram que se vincula; el token solo dice a QUÉ cuenta.
  const r = await clienteService.vincularTelegram(pedido.userId, telegramId);
  vinculo.consumir(token);
  if (!r.ok) {
    logger.audit('telegram_vinculo_fallido', { telegramId, userId: pedido.userId, motivo: r.motivo });
    return ctx.editMessageText(MOTIVOS[r.motivo] || MOTIVOS.no_disponible).catch(() => {});
  }

  logger.audit('telegram_vinculado', { telegramId, userId: pedido.userId });
  return ctx.editMessageText(
    '✅ ¡Listo! Tu Telegram quedó vinculado a tu cuenta de Cashy.\n\n' +
    'Probá escribiendo /ayuda. Los avisos de tus turnos ahora también te llegan por acá.'
  ).catch(() => {});
}

bot.action(/^vinculo_(ok|no):([A-Za-z0-9_-]{16})$/, handleVinculoDecision);

module.exports = { iniciarVinculo, handleVinculoDecision };
