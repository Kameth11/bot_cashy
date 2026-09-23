const { bot } = require('../../lib/telegraf');
const { esAdminOriginal } = require('../../auth');
const tenantRequestService = require('../../services/tenant-request.service');
const { GOOGLE_SERVICE_ACCOUNT_EMAIL } = require('../../config');
const state = require('../../state');

bot.command('aprobar', async (ctx) => {
  if (!esAdminOriginal(ctx.from.id)) {
    return ctx.reply('⛔ Solo el administrador puede usar este comando.');
  }

  const args = ctx.message.text.split(/\s+/).slice(1);
  const email = args[0]?.toLowerCase().trim();

  if (!email) {
    return ctx.reply('⚠️ Uso: /aprobar email@dominio.com');
  }

  const resultado = await tenantRequestService.aprobarSolicitud(email, ctx.from.id);

  if (!resultado.ok) {
    return ctx.reply(`❌ No se encontró una solicitud para \`${email}\`.\n\nVerificá con /solicitudes.`, { parse_mode: 'Markdown' });
  }

  const solicitud = resultado.data;

  // Notificar al usuario aprobado si tenemos su Telegram ID
  if (solicitud.telegram_user_id) {
    const userId = solicitud.telegram_user_id;
    // Setear el estado para que el próximo mensaje sea el sheet ID
    state.pendingRegistros.set(userId, { step: 'sheetId', email, telegramUserId: userId });

    bot.telegram.sendMessage(
      userId,
      '✅ *¡Tu solicitud fue aprobada!*\n\n' +
      'Ya podés configurar tu cuenta.\n\n' +
      '📊 *Paso 1:* Compartí tu Google Sheet con mi service account:\n\n' +
      `📧 *Email:* ${GOOGLE_SERVICE_ACCOUNT_EMAIL}\n\n` +
      'Dale permisos de "Editor"\n\n' +
      '📝 Ingresá el ID de tu spreadsheet:\n' +
      'Está en la URL: docs.google.com/spreadsheets/d/**AQUI_EL_ID**/edit\n\n' +
      'O usá /start si querés retomar más tarde.',
      { parse_mode: 'Markdown' }
    ).catch(err => console.error('Error notificando usuario aprobado:', err.message));
  }

  return ctx.reply(`✅ Solicitud de \`${email}\` aprobada.\n\nEl usuario fue notificado.`, { parse_mode: 'Markdown' });
});

module.exports = {};
