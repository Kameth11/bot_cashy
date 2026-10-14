const { bot } = require('../../lib/telegraf');
const { esAdminOriginal } = require('../../auth');
const tenantRequestService = require('../../services/tenant-request.service');
const textos = require('../../messages');

bot.command('solicitudes', async (ctx) => {
  if (!esAdminOriginal(ctx.from.id)) {
    return ctx.reply(textos.comandos.solicitudes.soloElAdministradorPuedeUsar);
  }

  const pendientes = await tenantRequestService.listarSolicitudesPendientes();

  if (!pendientes.length) {
    return ctx.reply(textos.comandos.solicitudes.noHaySolicitudesDeAcceso);
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
