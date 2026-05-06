const { Telegraf, Markup } = require('telegraf');
const { BOT_TOKEN } = require('../config');

const bot = new Telegraf(BOT_TOKEN);

module.exports = {
  Telegraf,
  Markup,
  bot,
};
