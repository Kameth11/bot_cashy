const { bot } = require('../../lib/telegraf');
const { obtenerClientePorUserId } = require('../../auth');
const clienteService = require('../../services/cliente.service');

bot.command('misusuarios', (ctx) => {
  const userId = ctx.from.id;
  const cliente = obtenerClientePorUserId(userId);

  if (!cliente) {
    return ctx.reply('⚠️ No tienes una cuenta registrada.');
  }

  const ownerId = parseInt(cliente.ownerId);
  if (ownerId !== userId) {
    return ctx.reply('⚠️ Solo el owner puede ver la lista de usuarios.');
  }

  const clientes = clienteService.clientes;
  const ownerCliente = clientes[ownerId];
  const usuarios = ownerCliente.usuarios || [];

  if (usuarios.length === 0) {
    return ctx.reply('👥 No hay usuarios adicionales autorizados.\n\nUsa /codigo para generar uno.');
  }

  let msg = `👥 *Usuarios autorizados:*\n\n`;
  usuarios.forEach((uid, i) => {
    msg += `${i + 1}. Usuario ID: ${uid}\n`;
  });
  msg += `\nUsa /codigo para agregar más.`;

  ctx.reply(msg, { parse_mode: 'Markdown' });
});

module.exports = {};
