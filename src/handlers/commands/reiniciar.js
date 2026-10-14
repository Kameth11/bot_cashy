const { bot } = require('../../lib/telegraf');
const { esAdminOriginal } = require('../../auth');
const state = require('../../state');
const { confirmButtons } = require('../actions');
const textos = require('../../messages');

bot.command('reiniciar', async (ctx) => {
  try {
  const userId = ctx.from.id;

  if (!esAdminOriginal(userId)) {
    return ctx.reply(textos.comandos.reiniciar.soloElOwnerPuedeUsar).catch(() => {});
  }

  state.pendingReinicios.set(userId, true);

  await ctx.reply(
    '⚠️ *¿REINICIAR REGISTRO?*\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    'Se borrará:\n' +
    '• Tus datos locales\n' +
    '• Todos los movimientos del sheet\n\n' +
    '⚠️ *Esta acción es irreversible.*',
    {
      parse_mode: 'Markdown',
      ...confirmButtons('confirm_reset', 'cancel_reset')
    }
  );
  } catch (error) {
    console.error('Error /reiniciar:', error.message);
    ctx.reply(textos.comandos.reiniciar.errorAlReiniciar).catch(() => {});
  }
});

module.exports = {};