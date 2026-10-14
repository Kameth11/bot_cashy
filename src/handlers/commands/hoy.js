const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');
const { DASHBOARD_URL } = require('../../config');
const { requierePermisoBot } = require('../../auth/bot-permisos');
const textos = require('../../messages');

bot.command('hoy', async (ctx) => {
  if (!requierePermisoBot(ctx, 'ver_movimientos', '/hoy')) return;
  try {
    await ctx.reply(textos.comandos.hoy.cargando);
    const msg = await cmd.ejecutarHoy(ctx.from.id);
    const extra = { parse_mode: 'Markdown' };
    if (DASHBOARD_URL) extra.reply_markup = { inline_keyboard: [[{ text: '📊 Ver Dashboard', url: DASHBOARD_URL }]] };
    ctx.reply(msg, extra);
  } catch (error) {
    console.error('Error /hoy:', error.message);
    ctx.reply(textos.comandos.hoy.errorAlObtenerDatos);
  }
});

module.exports = {};
