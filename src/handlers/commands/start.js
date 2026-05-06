const { bot } = require('../../lib/telegraf');
const registrationService = require('../../services/registration.service');

bot.command('start', async (ctx) => {
  const result = await registrationService.handleStart(ctx.from.id);
  return ctx.reply(result.message, { parse_mode: result.parse_mode });
});

module.exports = {};
