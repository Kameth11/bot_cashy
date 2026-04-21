const { bot } = require('../../lib/telegraf');
const { obtenerDatosSheet } = require('../../services/sheet.service');
const { esEstaSemana, normalizarFecha } = require('../../utils/date');
const { formatFecha } = require('../../utils/formatter');

bot.command('semana', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet(ctx.from.id);
    const semana = datos.filter(d => esEstaSemana(d.fecha));

    if (semana.length === 0) {
      return ctx.reply('📭 No hay movimientos esta semana.');
    }

    const ingresos = semana.filter(d => d.tipo === 'Ingreso');
    const egresos = semana.filter(d => d.tipo === 'Egreso');

    const totalIngresos = ingresos.reduce((sum, d) => sum + d.monto, 0);
    const totalEgresos = egresos.reduce((sum, d) => sum + Math.abs(d.monto), 0);

    const porDia = {};
    semana.forEach(d => {
      const fechaKey = formatFecha(d.fecha);
      if (!porDia[fechaKey]) {
        porDia[fechaKey] = { cantidad: 0, ingresos: 0, egresos: 0 };
      }
      porDia[fechaKey].cantidad++;
      if (d.tipo === 'Ingreso') {
        porDia[fechaKey].ingresos += d.monto;
      } else {
        porDia[fechaKey].egresos += Math.abs(d.monto);
      }
    });

    let msg = `📊 *RESUMEN SEMANAL*\n`;
    msg += `━━━━━━━━━━━━━━━━━\n\n`;

    Object.keys(porDia).sort((a, b) => {
      const dateA = normalizarFecha(a);
      const dateB = normalizarFecha(b);
      return dateA - dateB;
    }).forEach(fecha => {
      const info = porDia[fecha];
      msg += `📅 ${fecha}: ${info.cantidad} mov - $${(info.ingresos - info.egresos).toLocaleString()}\n`;
    });

    msg += `\n━━━━━━━━━━━━━━━\n`;
    msg += `💰 Ingresos: ${ingresos.length} - $${totalIngresos.toLocaleString()}\n`;
    msg += `💸 Egresos: ${egresos.length} - $${totalEgresos.toLocaleString()}\n\n`;
    msg += `💵 *Neto semanal: $${(totalIngresos - totalEgresos).toLocaleString()}*`;

    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /semana:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

module.exports = {};
