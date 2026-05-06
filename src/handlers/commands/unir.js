const { bot } = require('../../lib/telegraf');
const { joinWithInviteCode } = require('../../services/invite.service');

bot.command('unir', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);

  if (args.length === 0) {
    return ctx.reply('⚠️ Uso: /unir [código]\n\nEjemplo: /unir ABC123');
  }

  const result = await joinWithInviteCode(ctx.from.id, args[0]);
  return ctx.reply(result.message, result.parse_mode ? { parse_mode: result.parse_mode } : undefined);
});

module.exports = {};
