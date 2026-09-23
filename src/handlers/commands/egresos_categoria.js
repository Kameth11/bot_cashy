const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');
const { DASHBOARD_URL } = require('../../config');
const { requierePermisoBot } = require('../../auth/bot-permisos');

bot.command('egresos_categoria', async (ctx) => {
  if (!requierePermisoBot(ctx, 'ver_balance', '/egresos_categoria')) return;
  try {
    await ctx.reply('⏳ Cargando...');
    const msg = await cmd.ejecutarEgresosCategoria(ctx.from.id);
    const extra = { parse_mode: 'Markdown' };
    if (DASHBOARD_URL) extra.reply_markup = { inline_keyboard: [[{ text: '📊 Ver Dashboard', url: DASHBOARD_URL }]] };
    ctx.reply(msg, extra);
  } catch (error) {
    console.error('Error /egresos_categoria:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

module.exports = {};
