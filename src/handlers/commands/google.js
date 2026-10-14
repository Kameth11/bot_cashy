const { bot } = require('../../lib/telegraf');
const clienteService = require('../../services/cliente.service');
const logger = require('../../lib/logger');
const textos = require('../../messages');

// /google            -> ¿tengo una cuenta de Google vinculada?
// /google desvincular -> la quita (después hay que volver a vincularla para entrar con Google)
bot.command('google', async (ctx) => {
  if (ctx.chat && ctx.chat.type !== 'private') return ctx.reply(textos.comandos.google.usaEsteComandoEnEl);

  const userId = ctx.from.id;
  const arg = String((ctx.message && ctx.message.text) || '').trim().split(/\s+/)[1] || '';
  const vinculada = Boolean(clienteService.clientes[String(userId)] && clienteService.clientes[String(userId)].googleSub);

  if (/^desvincular$/i.test(arg)) {
    if (!vinculada) return ctx.reply(textos.comandos.google.noTenesNingunaCuentaDe);
    await clienteService.desvincularGoogle(userId);
    logger.audit('auth_google_desvinculado', { userId });
    return ctx.reply(textos.comandos.google.listoQuiteLaCuentaDe);
  }

  return ctx.reply(vinculada
    ? '🔗 Tenés una cuenta de Google vinculada: podés entrar al dashboard con "Entrar con Google".\n\nPara quitarla: /google desvincular'
    : 'No tenés ninguna cuenta de Google vinculada.\n\nEn el dashboard tocá "Entrar con Google" y confirmá acá en el bot.');
});

module.exports = {};
