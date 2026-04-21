const { bot } = require('../../lib/telegraf');
const { obtenerDatosSheet } = require('../../services/sheet.service');
const { esEsteMes } = require('../../utils/date');

bot.command('mes', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet(ctx.from.id);
    const mes = datos.filter(d => esEsteMes(d.fecha));

    if (mes.length === 0) {
      return ctx.reply('📭 No hay movimientos este mes. :(');
    }

    const ingresos = mes.filter(d => d.tipo === 'Ingreso');
    const egresos = mes.filter(d => d.tipo === 'Egreso');

    const totalIngresos = ingresos.reduce((sum, d) => sum + d.monto, 0);
    const totalEgresos = egresos.reduce((sum, d) => sum + Math.abs(d.monto), 0);

    const dolares = mes.filter(d => d.moneda === 'Dólares');
    const pesos = mes.filter(d => d.moneda === 'Pesos');

    let msg = `📊 *BALANCE DEL MES*\n`;
    msg += `━━━━━━━━━━━━━━━━━\n\n`;
    msg += `💰 Ingresos: ${ingresos.length} - $${totalIngresos.toLocaleString()}\n`;
    msg += `💸 Egresos: ${egresos.length} - $${totalEgresos.toLocaleString()}\n\n`;
    msg += `💵 *Neto: $${(totalIngresos - totalEgresos).toLocaleString()}*\n\n`;

    msg += `📊 *Por moneda:*\n`;
    msg += `   Pesos: ${pesos.length} movimientos\n`;
    msg += `   Dólares: ${dolares.length} movimientos`;

    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /mes:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

module.exports = {};
