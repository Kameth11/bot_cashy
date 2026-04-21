const { bot } = require('../../lib/telegraf');
const { obtenerDatosSheet } = require('../../services/sheet.service');
const { formatFecha, formatMonto } = require('../../utils/formatter');

bot.command('ingresos', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet(ctx.from.id);
    const ingresos = datos.filter(d => d.tipo === 'Ingreso');

    if (ingresos.length === 0) {
      return ctx.reply('📭 No hay ingresos registrados.');
    }

    const ultimos = ingresos.slice(-20).reverse();

    let msg = `💰 *ÚLTIMOS INGRESOS*\n\n`;
    ultimos.forEach(d => {
      msg += `✅ ${d.descripcion}\n`;
      msg += `   ${formatMonto(d.monto, d.moneda)} - ${d.metodoPago || 'sin método'}\n`;
      msg += `   ${formatFecha(d.fecha)} ${d.hora}\n\n`;
    });

    const total = ingresos.reduce((sum, d) => sum + d.monto, 0);
    msg += `━━━━━━━━━━━━━━━\n`;
    msg += `💵 Total ingresos: $${total.toLocaleString()}`;

    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /ingresos:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

module.exports = {};
