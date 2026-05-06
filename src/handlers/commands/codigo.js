const { bot } = require('../../lib/telegraf');
const { esAdminOriginal, obtenerClientePorUserId } = require('../../auth');
const { createInviteCode, buildInviteCodeMessage, generateInviteCode } = require('../../services/invite.service');

bot.command('codigo', (ctx) => {
  const userId = ctx.from.id;

  if (esAdminOriginal(userId)) {
    const codigo = createInviteCode(userId);

    ctx.reply(buildInviteCodeMessage(codigo), { parse_mode: 'Markdown' });
  } else {
    const cliente = obtenerClientePorUserId(userId);
    if (!cliente) {
      return ctx.reply('⚠️ No tienes una cuenta registrada.');
    }

    const ownerId = parseInt(cliente.ownerId, 10);

    if (!cliente.isOwner || ownerId !== userId) {
      return ctx.reply('⚠️ Solo el owner puede generar códigos de invitación.');
    }

    const codigo = createInviteCode(ownerId);

    ctx.reply(buildInviteCodeMessage(codigo), { parse_mode: 'Markdown' });
  }
});

module.exports = { generateInviteCode };
