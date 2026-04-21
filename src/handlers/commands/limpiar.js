const { bot } = require('../../lib/telegraf');
const { getSheetId, getSheetCliente } = require('../../services/sheet.service');
const state = require('../../state');

bot.command('limpiar', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const sheetId = getSheetId(userId);

    if (!sheetId) {
      return ctx.reply('❌ No tienes un Sheet configurado. Usa /start.');
    }

    await ctx.reply('🧹 *LIMPIEZA DEL SHEET*\n\n⏳ Analizando filas...');

    const sheet = await getSheetCliente(userId);
    const filasRaw = await sheet.getRows();
    const totalFilas = filasRaw.length;

    const filasInvalidas = [];
    
    filasRaw.forEach((fila, index) => {
      const rowObj = fila.toObject ? fila.toObject() : fila;
      const fecha = rowObj.Fecha || rowObj.fecha || '';
      const descripcion = rowObj.Descripcion || rowObj.descripcion || rowObj.Paciente || '';
      const monto = parseFloat(rowObj.Monto || rowObj.monto || 0);

      const esValida = fecha && fecha.trim() !== '' && 
                      descripcion && descripcion.trim() !== '' && 
                      monto && monto !== 0;

      if (!esValida) {
        filasInvalidas.push({ fila, index });
      }
    });

    if (filasInvalidas.length === 0) {
      return ctx.reply('✅ *¡Todo limpio!*\n\nNo hay filas inválidas en tu Sheet.');
    }

    state.pendingLimpiezas.set(userId, { filas: filasInvalidas, sheet });

    let msg = `🧹 *FILAS A ELIMINAR*\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📊 Total filas: ${totalFilas}\n`;
    msg += `❌ Filas inválidas: ${filasInvalidas.length}\n\n`;
    msg += `*Detalles:*\n`;

    if (filasInvalidas.length <= 10) {
      filasInvalidas.forEach((item, i) => {
        const rowObj = item.fila.toObject ? item.fila.toObject() : item.fila;
        const fecha = rowObj.Fecha || rowObj.fecha || '(vacía)';
        const desc = rowObj.Descripcion || rowObj.descripcion || rowObj.Paciente || '(vacía)';
        const monto = rowObj.Monto || rowObj.monto || '0';
        msg += `\n${i + 1}. Fila #${item.index + 1}\n`;
        msg += `   📅: ${fecha} | 💰: $${monto}\n`;
        msg += `   📝: ${desc.substring(0, 50)}`;
      });
    } else {
      msg += `Primeras 5:\n`;
      filasInvalidas.slice(0, 5).forEach((item, i) => {
        msg += `${i + 1}. Fila #${item.index + 1}\n`;
      });
      msg += `\n...y ${filasInvalidas.length - 5} más`;
    }

    msg += `\n\n⚠️ *¿Confirmas la eliminación?*\n`;
    msg += `Responde *sí* para eliminar o *no* para cancelar.`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error /limpiar:', error.message, error.stack);
    await ctx.reply('❌ Error al analizar el Sheet. Revisa los logs.');
  }
});

module.exports = {};
