const { bot } = require('../../lib/telegraf');
const registrationService = require('../../services/registration.service');

bot.command('start', async (ctx) => {
  const result = await registrationService.handleStart(ctx.from.id);
  const extra = { parse_mode: result.parse_mode };
  if (result.reply_markup) extra.reply_markup = result.reply_markup;
  return ctx.reply(result.message, extra);
});

module.exports = {};
