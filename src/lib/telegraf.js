const { Telegraf, Markup } = require('telegraf');
const { BOT_TOKEN } = require('../config');

const bot = new Telegraf(BOT_TOKEN);

// Red de seguridad: sin esto, cualquier error que se escape de un handler
// (ej. un `return promesa` sin `await` dentro de un try/catch local, que
// hace que ese catch nunca corra) queda solo en el log por defecto de
// Telegraf y el usuario no recibe absolutamente ninguna respuesta.
bot.catch((err, ctx) => {
  console.error(`Error no atrapado en update de ${ctx.updateType}:`, err);
  if (ctx.reply) {
    ctx.reply('❌ Ocurrió un error inesperado. Intentá de nuevo.').catch(() => {});
  }
});

module.exports = {
  Telegraf,
  Markup,
  bot,
};
