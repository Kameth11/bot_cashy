const { bot } = require('../../lib/telegraf');
const { obtenerCotizacionDolar } = require('../../services/cotizacion.service');
const state = require('../../state');

bot.command('dolar', async (ctx) => {
  try {
    console.log('Comando /dolar ejecutado. Cotización actual:', state.cotizacionDolar);

    if (!state.cotizacionDolar) {
      await ctx.reply('⏳ Obteniendo cotización de Bluelytics...');
      const cotizacion = await obtenerCotizacionDolar();
      if (!cotizacion) {
        return ctx.reply('❌ No se pudo obtener la cotización desde Bluelytics.\n\nPodés usar `/actualizardolar` para reintentar o configurar manualmente en .env con COTIZACION_DEFAULT.');
      }
    }

    const fechaFormateada = state.cotizacionFecha ? state.cotizacionFecha.toLocaleString('es-AR') : 'desconocida';
    ctx.reply(
      `💵 *Cotización Dólar Blue*\n\n` +
      `📊 Promedio: $${state.cotizacionDolar.toLocaleString('es-AR')}\n` +
      `🕐 Actualizada: ${fechaFormateada}\n\n` +
      `Fuente: Bluelytics`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error /dolar:', error.message);
    ctx.reply('❌ Error al obtener cotización.');
  }
});

module.exports = {};
