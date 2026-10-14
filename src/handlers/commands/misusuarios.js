const { bot } = require('../../lib/telegraf');
const { esAdminOriginal, obtenerClientePorUserId } = require('../../auth');
const clienteService = require('../../services/cliente.service');
const textos = require('../../messages');

bot.command('misusuarios', (ctx) => {
  const userId = ctx.from.id;
  const esAdmin = esAdminOriginal(userId);
  const cliente = obtenerClientePorUserId(userId);

  if (!cliente && !esAdmin) {
    return ctx.reply(textos.comandos.misusuarios.noTienesUnaCuentaRegistrada);
  }

  const ownerId = esAdmin ? userId : parseInt(cliente.ownerId, 10);
  if (!esAdmin && (!cliente.isOwner || ownerId !== userId)) {
    return ctx.reply(textos.comandos.misusuarios.soloElOwnerPuedeVer);
  }

  const clientes = clienteService.clientes;
  const ownerCliente = clientes[ownerId] || clientes[String(ownerId)] || null;
  if (!ownerCliente) {
    return ctx.reply(textos.comandos.misusuarios.noHayUsuariosAdicionalesAutorizados);
  }

  const usuarios = ownerCliente.usuarios || [];

  if (usuarios.length === 0) {
    return ctx.reply(textos.comandos.misusuarios.noHayUsuariosAdicionalesAutorizados);
  }

  let msg = `👥 *Usuarios autorizados:*\n\n`;
  usuarios.forEach((uid, i) => {
    msg += `${i + 1}. Usuario ID: ${uid}\n`;
  });
  msg += `\nUsa /codigo para agregar más.`;

  ctx.reply(msg, { parse_mode: 'Markdown' });
});

module.exports = {};
