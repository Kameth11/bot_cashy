const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');
const state = require('../../state');
const { confirmButtons } = require('../actions');

bot.command('eliminar', async (ctx) => {
  try {
    const texto = ctx.message.text.replace('/eliminar', '').trim().toLowerCase();
    const result = await cmd.prepararEliminacion(ctx.from.id, texto || null);

    if (typeof result === 'string') {
      return ctx.reply(result, { parse_mode: 'Markdown' });
    }

    state.pendingDeletes.set(ctx.from.id, result.state);
    ctx.reply(result.mensaje, {
      parse_mode: 'Markdown',
      ...confirmButtons('confirm_delete', 'cancel_delete')
    });
  } catch (error) {
    console.error('Error /eliminar:', error.message);
    ctx.reply('❌ Error al buscar movimiento.');
  }
});

module.exports = {};
