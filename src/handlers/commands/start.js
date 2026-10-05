const { bot } = require('../../lib/telegraf');
const registrationService = require('../../services/registration.service');

// /start login_<id>: el deep link del login "Entrar con Telegram". Nunca entra al
// registro: aunque el payload esté mal formado, solo se responde sobre el login.
const PAYLOAD_LOGIN = /^login_(.*)$/;

bot.command('start', async (ctx) => {
  const payload = String((ctx.message && ctx.message.text) || '').trim().split(/\s+/)[1] || '';
  const login = PAYLOAD_LOGIN.exec(payload);
  if (login) {
    const { iniciarAprobacionLogin } = require('../login-actions');
    return iniciarAprobacionLogin(ctx, login[1]);
  }

  const result = await registrationService.handleStart(ctx.from.id);
  const extra = { parse_mode: result.parse_mode };
  if (result.reply_markup) extra.reply_markup = result.reply_markup;
  return ctx.reply(result.message, extra);
});

module.exports = {};
