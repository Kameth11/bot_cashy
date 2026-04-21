const { bot } = require('../../lib/telegraf');
const { obtenerCotizacionDolar } = require('../../services/cotizacion.service');

bot.command('actualizardolar', async (ctx) => {
  try {
    await ctx.reply('⏳ Actualizando cotización...');
    const cotizacion = await obtenerCotizacionDolar();
    if (cotizacion) {
      ctx.reply(`✅ Cotización actualizada a $${cotizacion.toLocaleString('es-AR')}`);
    } else {
      ctx.reply('❌ No se pudo actualizar la cotización.');
    }
  } catch (error) {
    ctx.reply('❌ Error al actualizar cotización.');
  }
});

module.exports = {};
