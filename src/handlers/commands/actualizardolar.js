const { bot } = require('../../lib/telegraf');
const { obtenerCotizacionDolar } = require('../../services/cotizacion.service');
const textos = require('../../messages');

bot.command('actualizardolar', async (ctx) => {
  try {
    await ctx.reply(textos.comandos.actualizardolar.actualizandoCotizacion);
    const cotizacion = await obtenerCotizacionDolar();
    if (cotizacion) {
      ctx.reply(`✅ Cotización actualizada a $${cotizacion.toLocaleString('es-AR')}`);
    } else {
      ctx.reply(textos.comandos.actualizardolar.noSePudoActualizarLa);
    }
  } catch (error) {
    ctx.reply(textos.comandos.actualizardolar.errorAlActualizarCotizacion);
  }
});

module.exports = {};
