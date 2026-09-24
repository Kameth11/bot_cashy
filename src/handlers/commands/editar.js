const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');
const state = require('../../state');
const { requierePermisoBot } = require('../../auth/bot-permisos');

bot.command('editar', async (ctx) => {
  if (!requierePermisoBot(ctx, 'editar_movimientos', '/editar')) return;
  try {
    const texto = ctx.message.text.replace('/editar', '').trim().toLowerCase();
    const result = await cmd.prepararEdicion(ctx.from.id, texto || null);

    if (typeof result === 'string') {
      return ctx.reply(result, { parse_mode: 'Markdown' });
    }

    // El estado se setea DESPUÉS de que el envío salga bien: si Telegram
    // rechaza el mensaje (descripción con _ o * sin escapar, por ej.), antes
    // pendingEdits quedaba seteado igual y el usuario quedaba trabado.
    await ctx.reply(result.mensaje, { parse_mode: 'Markdown' });
    state.pendingEdits.set(ctx.from.id, result.state);
  } catch (error) {
    console.error('Error /editar:', error.message);
    ctx.reply('❌ Error al buscar movimiento.');
  }
});

module.exports = {};
