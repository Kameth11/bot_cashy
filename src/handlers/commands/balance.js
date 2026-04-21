const { bot } = require('../../lib/telegraf');
const { obtenerDatosSheet } = require('../../services/sheet.service');
const { esHoy, esEstaSemana, esEsteMes } = require('../../utils/date');

bot.command('balance', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet(ctx.from.id);

    const hoy = datos.filter(d => esHoy(d.fecha));
    const semana = datos.filter(d => esEstaSemana(d.fecha));
    const mes = datos.filter(d => esEsteMes(d.fecha));

    const totalHoy = hoy.reduce((sum, d) => sum + (d.monto || 0), 0);
    const totalSemana = semana.reduce((sum, d) => sum + (d.monto || 0), 0);
    const totalMes = mes.reduce((sum, d) => sum + (d.monto || 0), 0);

    const ingresosHoy = hoy.filter(d => d.tipo === 'Ingreso').reduce((sum, d) => sum + d.monto, 0);
    const egresosHoy = hoy.filter(d => d.tipo === 'Egreso').reduce((sum, d) => sum + Math.abs(d.monto), 0);

    const pendientes = datos.filter(d => d.estado === 'Pendiente');
    const pendientesHoy = pendientes.filter(d => esHoy(d.fecha));
    const totalPendiente = pendientes.reduce((sum, d) => sum + (d.monto || 0), 0);

    const msg =
      `💰 *RESUMEN DE CAJA*\n\n` +
      `📅 *Hoy:*\n` +
      `   Ingresos: $${ingresosHoy.toLocaleString()}\n` +
      `   Egresos: $${egresosHoy.toLocaleString()}\n` +
      `   Neto: $${(ingresosHoy - egresosHoy).toLocaleString()}\n` +
      `   Pendientes: ${pendientesHoy.length}\n\n` +
      `📆 *Esta semana:* $${totalSemana.toLocaleString()}\n\n` +
      `📆 *Este mes:* $${totalMes.toLocaleString()}\n` +
      `   Movimientos: ${mes.length}\n` +
      `   Pendientes total: ${pendientes.length} ($${totalPendiente.toLocaleString()})`;

    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /balance:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

module.exports = {};
