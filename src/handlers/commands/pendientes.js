const { bot } = require('../../lib/telegraf');
const { obtenerDatosSheet } = require('../../services/sheet.service');
const { esHoy } = require('../../utils/date');
const { formatFecha, formatMonto } = require('../../utils/formatter');

bot.command('pendientes', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet(ctx.from.id);
    const pendientes = datos.filter(d => d.estado === 'Pendiente');

    if (pendientes.length === 0) {
      return ctx.reply('✅ No hay movimientos pendientes. ¡Todo cobrado!');
    }

    const pendientesHoy = pendientes.filter(d => esHoy(d.fecha));
    const pendientesAntiguos = pendientes.filter(d => !esHoy(d.fecha));

    let msg = `⏳ *MOVIMIENTOS PENDIENTES*\n\n`;

    if (pendientesHoy.length > 0) {
      msg += `📅 *Hoy:*\n`;
      pendientesHoy.forEach(d => {
        msg += `• ${d.descripcion} - ${formatMonto(d.monto, d.moneda)}\n`;
      });
      msg += `\n`;
    }

    if (pendientesAntiguos.length > 0) {
      msg += `📆 *Anteriores:*\n`;
      pendientesAntiguos.slice(0, 10).forEach(d => {
        msg += `• ${d.descripcion} - ${formatFecha(d.fecha)} - ${formatMonto(d.monto, d.moneda)}\n`;
      });
      if (pendientesAntiguos.length > 10) {
        msg += `... y ${pendientesAntiguos.length - 10} más\n`;
      }
    }

    const totalPendiente = pendientes.reduce((sum, d) => sum + (d.monto || 0), 0);
    msg += `\n━━━━━━━━━━━━━━━\n`;
    msg += `💵 Total pendiente: $${totalPendiente.toLocaleString()}`;

    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /pendientes:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

module.exports = {};
