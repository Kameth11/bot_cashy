const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');

bot.command('cobrar', async (ctx) => {
  try {
    const texto = ctx.message.text.replace('/cobrar', '').trim();
    const msg = await cmd.ejecutarCobrar(ctx.from.id, texto || null);
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /cobrar:', error.message);
    ctx.reply('❌ Error al actualizar el pendiente.');
  }
});

module.exports = {};
