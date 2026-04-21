const { bot } = require('../../lib/telegraf');
const { obtenerDatosSheet } = require('../../services/sheet.service');
const { formatFecha, formatMonto } = require('../../utils/formatter');

bot.command('egresos', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet(ctx.from.id);
    const egresos = datos.filter(d => d.tipo === 'Egreso');

    if (egresos.length === 0) {
      return ctx.reply('📭 No hay egresos registrados.');
    }

    const ultimos = egresos.slice(-20).reverse();

    let msg = `💸 *ÚLTIMOS EGRESOS*\n\n`;
    ultimos.forEach(d => {
      msg += `🔻 ${d.descripcion}\n`;
      msg += `   ${formatMonto(d.monto, d.moneda)} - ${d.metodoPago || 'sin método'}\n`;
      msg += `   ${formatFecha(d.fecha)} ${d.hora}\n\n`;
    });

    const total = egresos.reduce((sum, d) => sum + Math.abs(d.monto), 0);
    msg += `━━━━━━━━━━━━━━━\n`;
    msg += `💵 Total egresos: $${total.toLocaleString()}`;

    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /egresos:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

module.exports = {};
