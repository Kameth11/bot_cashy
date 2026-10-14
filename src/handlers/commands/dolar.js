const { bot } = require('../../lib/telegraf');
const { obtenerCotizacionDolar } = require('../../services/cotizacion.service');
const state = require('../../state');
const textos = require('../../messages');

bot.command('dolar', async (ctx) => {
  try {
    console.log('Comando /dolar ejecutado. Cotización actual:', state.cotizacionDolar);

    if (!state.cotizacionDolar) {
      await ctx.reply(textos.comandos.dolar.obteniendoCotizacionDeBluelytics);
      const cotizacion = await obtenerCotizacionDolar();
      if (!cotizacion) {
        return ctx.reply(textos.comandos.dolar.noSePudoObtenerLa);
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
    ctx.reply(textos.comandos.dolar.errorAlObtenerCotizacion);
  }
});

module.exports = {};
