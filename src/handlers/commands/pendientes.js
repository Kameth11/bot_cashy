const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');

bot.command('pendientes', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const msg = await cmd.ejecutarPendientes(ctx.from.id);
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /pendientes:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

module.exports = {};
