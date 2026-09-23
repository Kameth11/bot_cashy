const { bot } = require('../../lib/telegraf');
const { obtenerClientePorUserId } = require('../../auth');
const clienteService = require('../../services/cliente.service');
const { canAttemptFullIA } = require('../../services/openrouter.service');
const { requiereDuenoBot } = require('../../auth/bot-permisos');

bot.command('modoia', async (ctx) => {
  const userId = ctx.from.id;
  const cliente = obtenerClientePorUserId(userId);

  if (!cliente) {
    return ctx.reply('⚠️ No tenés una cuenta registrada.');
  }

  if (!canAttemptFullIA()) {
    return ctx.reply('⚠️ El modo Full IA no está disponible todavía (falta configurar OpenRouter).');
  }

  const arg = ctx.message.text.replace('/modoia', '').trim().toLowerCase();
  const ownerId = cliente.ownerId;

  if (!arg) {
    const estado = cliente.modoFullIA ? 'activado ✅' : 'desactivado ❌';
    return ctx.reply(
      `🧠 *Modo Full IA*: ${estado}\n\n` +
      `Cuando está activado, todos tus mensajes se procesan con IA (OpenRouter) en vez de las reglas rápidas locales.\n\n` +
      `Usá \`/modoia on\` o \`/modoia off\` para cambiarlo.`,
      { parse_mode: 'Markdown' }
    );
  }

  if (!['on', 'off'].includes(arg)) {
    return ctx.reply('⚠️ Usá `/modoia on` o `/modoia off`.', { parse_mode: 'Markdown' });
  }

  // Activarlo genera costo en OpenRouter para todo el consultorio — solo
  // dueño/admin, aunque cualquier miembro registrado pueda ver el estado.
  if (!requiereDuenoBot(ctx, '/modoia')) return;

  const enabled = arg === 'on';
  await clienteService.setModoFullIA(ownerId, enabled);

  return ctx.reply(`🧠 Modo Full IA ${enabled ? 'activado ✅' : 'desactivado ❌'}.`);
});

module.exports = {};
