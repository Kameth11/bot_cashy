const { bot } = require('../lib/telegraf');
const state = require('../state');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_EVENTS, MAX_TEXT_LENGTH } = require('../config');

const COMANDOS_PUBLICOS = new Set(['/start', '/unir', '/cancelar']);

function esComandoPublico(ctx) {
  const text = ctx.message && typeof ctx.message.text === 'string'
    ? ctx.message.text.trim().toLowerCase()
    : '';

  if (!text.startsWith('/')) return false;

  const comando = text.split(/\s+/)[0].split('@')[0];
  return COMANDOS_PUBLICOS.has(comando);
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
      ctx.reply('⚠️ Demasiadas acciones seguidas. Esperá unos segundos e intentá otra vez.').catch(() => {});
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
      ctx.reply(`⚠️ El mensaje es demasiado largo. Máximo: ${MAX_TEXT_LENGTH} caracteres.`).catch(() => {});
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

  if (state.pendingRegistros.has(userId) || esComandoPublico(ctx)) {
    return next();
  }

  console.log(`Usuario no registrado: ${userId}`);
  if (ctx.reply) {
    ctx.reply('No estas autorizado para usar este bot. Usa /start para registrarte o /unir CODIGO si te invitaron.').catch(() => {});
  }
  return;
});

module.exports = {};
