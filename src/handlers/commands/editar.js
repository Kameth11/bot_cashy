const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');
const state = require('../../state');

bot.command('editar', async (ctx) => {
  try {
    const texto = ctx.message.text.replace('/editar', '').trim().toLowerCase();
    const result = await cmd.prepararEdicion(ctx.from.id, texto || null);
    if (typeof result === 'string') {
      return ctx.reply(result, { parse_mode: 'Markdown' });
    }

    state.pendingEdits.set(ctx.from.id, result.state);
    ctx.reply(result.mensaje, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error /editar:', error.message);
    ctx.reply('❌ Error al buscar movimiento.');
  }
});

module.exports = {};
