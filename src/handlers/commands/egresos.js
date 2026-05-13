const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');

bot.command('egresos', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const msg = await cmd.ejecutarEgresos(ctx.from.id);
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /egresos:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

module.exports = {};
