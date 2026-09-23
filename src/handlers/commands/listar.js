const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');
const { requierePermisoBot } = require('../../auth/bot-permisos');

bot.command('listar', async (ctx) => {
  if (!requierePermisoBot(ctx, 'ver_movimientos', '/listar')) return;
  try {
    await ctx.reply('⏳ Cargando movimientos...');
    const msg = await cmd.ejecutarListar(ctx.from.id);
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /listar:', error.message);
    ctx.reply('❌ Error al listar movimientos.');
  }
});

module.exports = {};
