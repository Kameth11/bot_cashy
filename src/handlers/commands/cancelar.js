const { bot } = require('../../lib/telegraf');
const state = require('../../state');

bot.command('cancelar', (ctx) => {
  const userId = ctx.from.id;
  state.pendingRegistros.delete(userId);
  state.pendingDeletes.delete(userId);
  state.pendingEdits.delete(userId);
  state.pendingCotizaciones.delete(userId);
  state.pendingIntentosEmail.delete(userId);
  state.pendingReinicios.delete(userId);
  ctx.reply('❌ Proceso cancelado.');
});

module.exports = {};
