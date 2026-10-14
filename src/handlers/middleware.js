const { bot } = require('../lib/telegraf');
const state = require('../state');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_EVENTS, MAX_TEXT_LENGTH } = require('../config');
const logger = require('../lib/logger');
const clienteService = require('../services/cliente.service');
const textos = require('../messages');

const COMANDOS_PUBLICOS = new Set(['/start', '/unir', '/cancelar']);

function esComandoPublico(ctx) {
  const text = ctx.message && typeof ctx.message.text === 'string'
    ? ctx.message.text.trim().toLowerCase()
    : '';

  if (!text.startsWith('/')) return false;

  const comando = text.split(/\s+/)[0].split('@')[0];
  return COMANDOS_PUBLICOS.has(comando);
}

// Un Telegram vinculado a una cuenta nacida en la web (ver cliente.service.vincularTelegram) ES esa
// cuenta para todo el bot: se reemplaza ctx.from.id por el de la cuenta ANTES de cualquier otra cosa,
// así los cientos de usos de ctx.from.id (permisos, sheets, estados) la ven sin tocarlos. El Telegram
// real queda en ctx.state.telegramId (para vincular/desvincular). ctx.from es el MISMO objeto del
// update, así que mutarlo vale para todo lo que sigue. Las respuestas no cambian: salen por ctx.chat.
bot.use((ctx, next) => {
  if (ctx.from) {
    const cuenta = clienteService.cuentaPorTelegramId(ctx.from.id);
    if (cuenta) {
      ctx.state = ctx.state || {};
      ctx.state.telegramId = ctx.from.id;
      ctx.from.id = Number(cuenta);
    }
  }
  return next();
});

// El botón de confirmación del vínculo lo toca alguien que todavía NO tiene cuenta (por definición).
function esAccionPublica(ctx) {
  const data = ctx.callbackQuery && typeof ctx.callbackQuery.data === 'string' ? ctx.callbackQuery.data : '';
  return data.startsWith('vinculo_');
}

bot.use((ctx, next) => {
  if (!ctx.from) return next();

  const userId = ctx.from.id;
  const now = Date.now();
  const rateState = state.userRateLimits.get(userId) || { timestamps: [], notifiedAt: 0 };
  const timestamps = rateState.timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);

  if (timestamps.length > RATE_LIMIT_MAX_EVENTS) {
    const puedeNotificar = rateState.notifiedAt + RATE_LIMIT_WINDOW_MS <= now;
    state.userRateLimits.set(userId, {
      timestamps,
      notifiedAt: puedeNotificar ? now : rateState.notifiedAt,
    });

    if (puedeNotificar && ctx.reply) {
      ctx.reply(textos.middleware.demasiadasAccionesSeguidasEsperaUnos).catch(() => {});
    }
    return;
  }

  if (timestamps.length === 0) {
    state.userRateLimits.delete(userId);
  } else {
    state.userRateLimits.set(userId, { timestamps, notifiedAt: 0 });
  }

  const text = ctx.message && typeof ctx.message.text === 'string' ? ctx.message.text : null;
  if (text && text.length > MAX_TEXT_LENGTH) {
    if (ctx.reply) {
      ctx.reply(textos.limites.mensajeLargo(MAX_TEXT_LENGTH)).catch(() => {});
    }
    return;
  }

  if (esAdminOriginal(userId)) {
    return next();
  }

  const cliente = obtenerClientePorUserId(userId);
  if (cliente) {
    return next();
  }

  if (state.pendingRegistros.has(userId) || esComandoPublico(ctx) || esAccionPublica(ctx)) {
    return next();
  }

  logger.audit('bot_unauthorized_access', { userId });
  if (ctx.reply) {
    ctx.reply(textos.middleware.noEstasAutorizadoParaUsar).catch(() => {});
  }
  return;
});

module.exports = {};
