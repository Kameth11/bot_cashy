const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');
const { DASHBOARD_URL } = require('../../config');
const { requierePermisoBot } = require('../../auth/bot-permisos');
const textos = require('../../messages');

bot.command('semana', async (ctx) => {
  if (!requierePermisoBot(ctx, 'ver_balance', '/semana')) return;
  try {
    await ctx.reply(textos.comandos.semana.cargando);
    const msg = await cmd.ejecutarSemana(ctx.from.id);
    const extra = { parse_mode: 'Markdown' };
    if (DASHBOARD_URL) extra.reply_markup = { inline_keyboard: [[{ text: '📊 Ver Dashboard', url: DASHBOARD_URL }]] };
    ctx.reply(msg, extra);
  } catch (error) {
    console.error('Error /semana:', error.message);
    ctx.reply(textos.comandos.semana.errorAlObtenerDatos);
  }
});

module.exports = {};
