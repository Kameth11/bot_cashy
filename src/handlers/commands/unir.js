const { bot } = require('../../lib/telegraf');
const { obtenerClientePorUserId } = require('../../auth');
const clienteService = require('../../services/cliente.service');
const state = require('../../state');

bot.command('unir', (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ').slice(1);

  if (obtenerClientePorUserId(userId)) {
    return ctx.reply('⚠️ Ya tienes una cuenta registrada. Habla con el owner si necesitas agregar otro usuario.');
  }

  if (args.length === 0) {
    return ctx.reply('⚠️ Uso: /unir [código]\n\nEjemplo: /unir ABC123');
  }

  const codigo = args[0].toUpperCase();
  const codigoData = state.pendingCodigos.get(codigo);

  if (!codigoData) {
    return ctx.reply('❌ Código inválido o expirado. Pide uno nuevo al owner.');
  }

  const ownerId = codigoData.ownerId;
  const clientes = clienteService.clientes;
  if (!clientes[ownerId]) {
    state.pendingCodigos.delete(codigo);
    return ctx.reply('❌ El owner ya no existe.');
  }

  if (!clientes[ownerId].usuarios) {
    clientes[ownerId].usuarios = [];
  }

  if (clientes[ownerId].usuarios.includes(userId)) {
    return ctx.reply('⚠️ Ya estás autorizado en esta cuenta.');
  }

  clientes[ownerId].usuarios.push(userId);
  clienteService.guardarClientes(clientes);
  state.pendingCodigos.delete(codigo);

  ctx.reply(
    `✅ *¡Te uniste correctamente!*\n\n` +
    `Ahora puedes usar el bot con la cuenta del owner.\n` +
    `Usa /start para ver los comandos disponibles.`,
    { parse_mode: 'Markdown' }
  );
});

module.exports = {};
