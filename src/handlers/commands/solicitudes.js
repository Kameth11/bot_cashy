const { bot } = require('../../lib/telegraf');
const { esAdminOriginal } = require('../../auth');
const tenantRequestService = require('../../services/tenant-request.service');

bot.command('solicitudes', async (ctx) => {
  if (!esAdminOriginal(ctx.from.id)) {
    return ctx.reply('⛔ Solo el administrador puede usar este comando.');
  }

  const pendientes = await tenantRequestService.listarSolicitudesPendientes();

  if (!pendientes.length) {
    return ctx.reply('✅ No hay solicitudes de acceso pendientes.');
  }

  let msg = `📋 *Solicitudes pendientes (${pendientes.length}):*\n\n`;
  pendientes.forEach((s, i) => {
    const fecha = new Date(s.created_at).toLocaleDateString('es-AR');
    msg += `${i + 1}. \`${s.email}\`\n   ID Telegram: \`${s.telegram_user_id || 'desconocido'}\`\n   Solicitado: ${fecha}\n\n`;
  });
  msg += 'Usá `/aprobar email@...` o `/rechazar email@...`';

  return ctx.reply(msg, { parse_mode: 'Markdown' });
});

module.exports = {};
