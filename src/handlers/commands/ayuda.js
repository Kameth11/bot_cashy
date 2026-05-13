const { bot } = require('../../lib/telegraf');
const { buildHelpMessage } = require('../../services/command.service');

bot.command('ayuda', (ctx) => {
  ctx.reply(buildHelpMessage(), { parse_mode: 'Markdown' });
});

module.exports = {};
