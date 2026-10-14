const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');
const { requierePermisoBot } = require('../../auth/bot-permisos');
const textos = require('../../messages');

bot.command('listar', async (ctx) => {
  if (!requierePermisoBot(ctx, 'ver_movimientos', '/listar')) return;
  try {
    await ctx.reply(textos.comandos.listar.cargandoMovimientos);
    const msg = await cmd.ejecutarListar(ctx.from.id);
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /listar:', error.message);
    ctx.reply(textos.comandos.listar.errorAlListarMovimientos);
  }
});

module.exports = {};
