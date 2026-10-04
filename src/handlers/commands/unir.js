const { bot } = require('../../lib/telegraf');
const { beginInviteRegistration } = require('../../services/invite.service');
const { canjearInvitacionCasa } = require('./casa');

bot.command('unir', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);

  if (args.length === 0) {
    return ctx.reply('⚠️ Uso: /unir [código]\n\nEjemplo: /unir ABC123');
  }

  // Un código de CASA se canjea sin tocar el consultorio ni la cuenta del usuario.
  if (await canjearInvitacionCasa(ctx, args[0], args.slice(1).join(' '))) return;

  const result = await beginInviteRegistration(ctx.from.id, args[0]);
  return ctx.reply(result.message, result.parse_mode ? { parse_mode: result.parse_mode } : undefined);
});

module.exports = {};
