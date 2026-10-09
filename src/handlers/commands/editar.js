const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');
const state = require('../../state');
const { requierePermisoBot } = require('../../auth/bot-permisos');

// Flujo del consultorio. Lo usa /editar y, desde gestion-gastos, la opción "Consultorio".
async function ejecutarEditar(ctx, texto) {
  if (!requierePermisoBot(ctx, 'editar_movimientos', '/editar')) return;
  try {
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
}

bot.command('editar', async (ctx) => {
  const texto = ctx.message.text.replace('/editar', '').trim().toLowerCase();
  // Sin argumento y con Personal o Casa: primero se pregunta de dónde.
  if (!texto && await require('../gestion-gastos').ofrecerAmbito(ctx, 'editar')) return;
  return ejecutarEditar(ctx, texto);
});

module.exports = { ejecutarEditar };
