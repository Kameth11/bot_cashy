const { bot } = require('../../lib/telegraf');
const { obtenerDatosSheet } = require('../../services/sheet.service');
const { esHoy } = require('../../utils/date');
const { formatMonto } = require('../../utils/formatter');

bot.command('hoy', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet(ctx.from.id);
    const hoy = datos.filter(d => esHoy(d.fecha));

    if (hoy.length === 0) {
      return ctx.reply('📭 No hay movimientos hoy.');
    }

    const ingresos = hoy.filter(d => d.tipo === 'Ingreso');
    const egresos = hoy.filter(d => d.tipo === 'Egreso');

    let msg = `📋 *MOVIMIENTOS DE HOY*\n\n`;

    if (ingresos.length > 0) {
      msg += `💰 *Ingresos:*\n`;
      ingresos.forEach(d => {
        msg += `✅ ${d.descripcion}\n`;
        msg += `   ${formatMonto(d.monto, d.moneda)} - ${d.metodoPago || 'pendiente'}\n\n`;
      });
    }

    if (egresos.length > 0) {
      msg += `💸 *Egresos:*\n`;
      egresos.forEach(d => {
        msg += `🔻 ${d.descripcion}\n`;
        msg += `   ${formatMonto(d.monto, d.moneda)} - ${d.metodoPago || 'pendiente'}\n\n`;
      });
    }

    const totalIngresos = ingresos.reduce((sum, d) => sum + d.monto, 0);
    const totalEgresos = egresos.reduce((sum, d) => sum + Math.abs(d.monto), 0);

    msg += `━━━━━━━━━━━━━━━\n`;
    msg += `💰 Ingresos: $${totalIngresos.toLocaleString()}\n`;
    msg += `💸 Egresos: $${totalEgresos.toLocaleString()}\n`;
    msg += `💵 Neto: $${(totalIngresos - totalEgresos).toLocaleString()}`;

    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /hoy:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

module.exports = {};
