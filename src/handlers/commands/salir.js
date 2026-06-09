const { bot } = require('../../lib/telegraf');
const { esAdminOriginal, obtenerClientePorUserId } = require('../../auth');
const { eliminarCliente } = require('../../services/cliente.service');

// /salir — el usuario se da de baja del bot
bot.command('salir', async (ctx) => {
  try {
    const userId = ctx.from.id;

    if (esAdminOriginal(userId)) {
      return ctx.reply(
        '⚠️ El administrador no puede usar /salir.\n' +
        'Si querés resetear todo, usá /reiniciar.'
      ).catch(() => {});
    }

    const cliente = obtenerClientePorUserId(userId);
    if (!cliente) {
      return ctx.reply('No estás registrado en el sistema.').catch(() => {});
    }

    await ctx.reply(
      '⚠️ *¿Seguro que querés salir?*\n\n' +
      'Se eliminarán:\n' +
      '• Tu registro en el bot\n' +
      '• Tu acceso al dashboard\n\n' +
      '_Tus datos en Google Sheets no se borran._\n\n' +
      'Respondé *SI* para confirmar o cualquier otra cosa para cancelar.',
      { parse_mode: 'Markdown' }
    );

    // Espera confirmación en el próximo mensaje
    const { pendingReinicios } = require('../../state');
    pendingReinicios.set(`salir_${userId}`, true);
  } catch (err) {
    console.error('Error /salir:', err.message);
    ctx.reply('❌ Error al procesar el comando.').catch(() => {});
  }
});

// Maneja la confirmación "SI" del /salir en text.js
async function procesarConfirmacionSalir(ctx) {
  const userId = ctx.from.id;
  const { pendingReinicios } = require('../../state');

  if (!pendingReinicios.get(`salir_${userId}`)) return false;

  const texto = (ctx.message?.text || '').trim().toUpperCase();
  if (texto !== 'SI') {
    pendingReinicios.delete(`salir_${userId}`);
    await ctx.reply('❌ Cancelado. Seguís registrado en el bot.').catch(() => {});
    return true;
  }

  pendingReinicios.delete(`salir_${userId}`);
  const eliminado = await eliminarCliente(userId);

  if (eliminado) {
    await ctx.reply(
      '✅ Te diste de baja correctamente.\n\n' +
      'Tus datos en Google Sheets se mantienen.\n' +
      'Si querés volver a registrarte, enviá /start.'
    ).catch(() => {});
  } else {
    await ctx.reply('❌ No se pudo completar la baja. Contactá al administrador.').catch(() => {});
  }

  return true;
}

module.exports = { procesarConfirmacionSalir };
