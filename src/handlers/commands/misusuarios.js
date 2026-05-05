const { bot } = require('../../lib/telegraf');
const { esAdminOriginal, obtenerClientePorUserId } = require('../../auth');
const clienteService = require('../../services/cliente.service');

bot.command('misusuarios', (ctx) => {
  const userId = ctx.from.id;
  const esAdmin = esAdminOriginal(userId);
  const cliente = obtenerClientePorUserId(userId);

  if (!cliente && !esAdmin) {
    return ctx.reply('⚠️ No tienes una cuenta registrada.');
  }

  const ownerId = esAdmin ? userId : parseInt(cliente.ownerId, 10);
  if (!esAdmin && (!cliente.isOwner || ownerId !== userId)) {
    return ctx.reply('⚠️ Solo el owner puede ver la lista de usuarios.');
  }

  const clientes = clienteService.clientes;
  const ownerCliente = clientes[ownerId] || clientes[String(ownerId)] || null;
  if (!ownerCliente) {
    return ctx.reply('👥 No hay usuarios adicionales autorizados.\n\nUsa /codigo para generar uno.');
  }

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
