const { bot } = require('../../lib/telegraf');
const { esAdminOriginal } = require('../../auth');
const tenantRequestService = require('../../services/tenant-request.service');

bot.command('rechazar', async (ctx) => {
  if (!esAdminOriginal(ctx.from.id)) {
    return ctx.reply('⛔ Solo el administrador puede usar este comando.');
  }

  const args = ctx.message.text.split(/\s+/).slice(1);
  const email = args[0]?.toLowerCase().trim();

  if (!email) {
    return ctx.reply('⚠️ Uso: /rechazar email@dominio.com');
  }

  const resultado = await tenantRequestService.rechazarSolicitud(email, ctx.from.id);

  if (!resultado.ok) {
    return ctx.reply(`❌ No se encontró una solicitud para \`${email}\`.\n\nVerificá con /solicitudes.`, { parse_mode: 'Markdown' });
  }

  const solicitud = resultado.data;

  if (solicitud.telegram_user_id) {
    bot.telegram.sendMessage(
      solicitud.telegram_user_id,
      '❌ Tu solicitud de acceso fue rechazada.\n\nSi creés que es un error, contactá al administrador.',
    ).catch(err => console.error('Error notificando usuario rechazado:', err.message));
  }

  return ctx.reply(`❌ Solicitud de \`${email}\` rechazada.\n\nEl usuario fue notificado.`, { parse_mode: 'Markdown' });
});

module.exports = {};
