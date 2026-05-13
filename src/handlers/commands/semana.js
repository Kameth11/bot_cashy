const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');

bot.command('semana', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const msg = await cmd.ejecutarSemana(ctx.from.id);
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /semana:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

module.exports = {};
