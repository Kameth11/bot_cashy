const { bot } = require('../lib/telegraf');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');

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

  console.log(`Usuario no registrado: ${userId}`);
  return next();
});

module.exports = {};
