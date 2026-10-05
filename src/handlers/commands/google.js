const { bot } = require('../../lib/telegraf');
const clienteService = require('../../services/cliente.service');
const logger = require('../../lib/logger');

// /google            -> ¿tengo una cuenta de Google vinculada?
// /google desvincular -> la quita (después hay que volver a vincularla para entrar con Google)
bot.command('google', async (ctx) => {
  if (ctx.chat && ctx.chat.type !== 'private') return ctx.reply('Usá este comando en el chat privado conmigo.');

  const userId = ctx.from.id;
  const arg = String((ctx.message && ctx.message.text) || '').trim().split(/\s+/)[1] || '';
  const vinculada = Boolean(clienteService.clientes[String(userId)] && clienteService.clientes[String(userId)].googleSub);

  if (/^desvincular$/i.test(arg)) {
    if (!vinculada) return ctx.reply('No tenés ninguna cuenta de Google vinculada.');
    await clienteService.desvincularGoogle(userId);
    logger.audit('auth_google_desvinculado', { userId });
    return ctx.reply('✅ Listo, quité la cuenta de Google. Para volver a entrar con Google tenés que vincularla de nuevo desde el dashboard.');
  }

  return ctx.reply(vinculada
    ? '🔗 Tenés una cuenta de Google vinculada: podés entrar al dashboard con "Entrar con Google".\n\nPara quitarla: /google desvincular'
    : 'No tenés ninguna cuenta de Google vinculada.\n\nEn el dashboard tocá "Entrar con Google" y confirmá acá en el bot.');
});

module.exports = {};
