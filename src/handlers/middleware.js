const { bot } = require('../lib/telegraf');
const state = require('../state');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');

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
