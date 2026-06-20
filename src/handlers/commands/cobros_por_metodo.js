const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');
const { DASHBOARD_URL } = require('../../config');

bot.command('cobros_por_metodo', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const msg = await cmd.ejecutarCobrosPorMetodo(ctx.from.id);
    const extra = { parse_mode: 'Markdown' };
    if (DASHBOARD_URL) extra.reply_markup = { inline_keyboard: [[{ text: '📊 Ver Dashboard', url: DASHBOARD_URL }]] };
    ctx.reply(msg, extra);
  } catch (error) {
    console.error('Error /cobros_por_metodo:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

module.exports = {};
