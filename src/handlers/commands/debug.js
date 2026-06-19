const { bot } = require('../../lib/telegraf');
const { getSheetId, obtenerDatosSheet } = require('../../services/sheet.service');
const { normalizarFecha, esHoy, esEsteMes } = require('../../utils/date');
const { formatMonto } = require('../../utils/formatter');

bot.command('debug', async (ctx) => {
  try {
    await ctx.reply('🔍 *DIAGNÓSTICO DEL SISTEMA*\n\n⏳ Analizando...');

    const userId = ctx.from.id;
    const sheetId = getSheetId(userId);

    if (!sheetId) {
      return ctx.reply('❌ No tienes un Sheet configurado. Usa /start.');
    }

    const datosRaw = await obtenerDatosSheet(userId);
    const totalFilas = datosRaw.length;

    const conFecha = datosRaw.filter(d => d.fecha && d.fecha.trim() !== '');
    const conDescripcion = datosRaw.filter(d => d.descripcion && d.descripcion.trim() !== '');
    const conMonto = datosRaw.filter(d => d.monto && d.monto !== 0);
    const filasValidas = datosRaw.filter(d => 
      d.fecha && d.fecha.trim() !== '' &&
      d.descripcion && d.descripcion.trim() !== '' &&
      d.monto && d.monto !== 0
    );

    const mes = filasValidas.filter(d => esEsteMes(d.fecha));
    const hoy = filasValidas.filter(d => esHoy(d.fecha));

    let msg = `🔍 *DIAGNÓSTICO*\n\n`;
    msg += `📄 *Sheet ID:* \`${sheetId}\`\n`;
    msg += `👤 *User ID:* ${userId}\n\n`;
    msg += `📊 *ESTADÍSTICAS DE FILAS*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Total filas leídas: ${totalFilas}\n`;
    msg += `Con fecha: ${conFecha.length}\n`;
    msg += `Con descripción: ${conDescripcion.length}\n`;
    msg += `Con monto válido: ${conMonto.length}\n`;
    msg += `✅ *Filas válidas (con todo): ${filasValidas.length}*\n\n`;
    msg += `📅 *DEL MES ACTUAL*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Movimientos: ${mes.length}\n`;
    msg += `Total: $${mes.reduce((sum, d) => sum + d.monto, 0).toLocaleString('es-AR')}\n\n`;
    msg += `📆 *HOY*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Movimientos: ${hoy.length}\n`;
    msg += `Total: $${hoy.reduce((sum, d) => sum + d.monto, 0).toLocaleString('es-AR')}`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });

    const analisisMensual = {};
    filasValidas.forEach(d => {
      const fecha = normalizarFecha(d.fecha);
      if (fecha) {
        const clave = `${fecha.getFullYear()}-${(fecha.getMonth() + 1).toString().padStart(2, '0')}`;
        if (!analisisMensual[clave]) {
          analisisMensual[clave] = { count: 0, total: 0 };
        }
        analisisMensual[clave].count++;
        analisisMensual[clave].total += d.monto;
      }
    });

    if (Object.keys(analisisMensual).length > 0) {
      let msg2 = `📅 *ANÁLISIS POR MES*\n`;
      msg2 += `━━━━━━━━━━━━━━━━━━━━\n`;
      
      const mesesOrdenados = Object.keys(analisisMensual).sort().reverse();
      mesesOrdenados.forEach(mes => {
        const [anio, mesNum] = mes.split('-');
        const nombresMeses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                              'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const nombreMes = nombresMeses[parseInt(mesNum) - 1];
        const datos = analisisMensual[mes];
        const esMesActual = mes === `${new Date().getFullYear()}-${(new Date().getMonth() + 1).toString().padStart(2, '0')}`;
        
        msg2 += `\n📆 ${nombreMes} ${anio}${esMesActual ? ' *(MES ACTUAL)*' : ''}\n`;
        msg2 += `   Movimientos: ${datos.count}\n`;
        msg2 += `   Total: $${datos.total.toLocaleString('es-AR')}`;
      });
      
      await ctx.reply(msg2, { parse_mode: 'Markdown' });
    }

    if (filasValidas.length > 0) {
      let msg3 = `📋 *TODOS LOS MOVIMIENTOS*\n`;
      msg3 += `━━━━━━━━━━━━━━━━━━━━\n`;
      msg3 += `(${filasValidas.length} movimientos en total)\n\n`;
      
      const hoy = new Date();
      filasValidas.forEach((d, i) => {
        const fecha = normalizarFecha(d.fecha);
        const esDeEsteMes = fecha && esEsteMes(d.fecha);
        const marker = esDeEsteMes ? '✅' : '📅';
        
        msg3 += `${marker} ${i + 1}. ${d.descripcion.substring(0, 40)}\n`;
        msg3 += `   💰 ${formatMonto(d.monto, d.moneda)} | ${d.fecha}\n`;
        if (i < filasValidas.length - 1) msg3 += '\n';
      });
      
      await ctx.reply(msg3, { parse_mode: 'Markdown' });
    }

    if (totalFilas > filasValidas.length) {
      const filasInvalidas = totalFilas - filasValidas.length;
      let msg4 = `⚠️ *FILAS INVÁLIDAS ENCONTRADAS*\n`;
      msg4 += `━━━━━━━━━━━━━━━━━━━━\n`;
      msg4 += `Hay ${filasInvalidas} filas que no tienen todos los datos necesarios.\n\n`;
      msg4 += `💡 *Solución:* Usa /limpiar para eliminar estas filas del Sheet.`;
      await ctx.reply(msg4, { parse_mode: 'Markdown' });
    }

  } catch (error) {
    console.error('Error /debug:', error.message, error.stack);
    await ctx.reply('❌ Error en el diagnóstico. Revisa los logs.');
  }
});

module.exports = {};
