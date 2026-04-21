const { bot } = require('../../lib/telegraf');
const { getSheetCliente } = require('../../services/sheet.service');
const { generarIDUnico } = require('../../services/movimiento.service');

bot.command('regenerar_ids', async (ctx) => {
  try {
    await ctx.reply('🔄 Buscando filas sin ID...');
    
    const sheet = await getSheetCliente(ctx.from.id);
    if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');
    
    const filas = await sheet.getRows();
    
    let actualizados = 0;
    let yaTenianId = 0;
    
    for (let i = 0; i < filas.length; i++) {
      const f = filas[i];
      
      const idActual = f.get('ID_Unico') || f.get('ID_unico') || '';
      
      if (!idActual || idActual === 'undefined' || idActual === 'null' || idActual.trim() === '') {
        const nuevoId = generarIDUnico();
        f.set('ID_Unico', nuevoId);
        await f.save();
        actualizados++;
        console.log(`✅ Fila ${i + 1}: ID guardado -> ${nuevoId}`);
      } else {
        yaTenianId++;
      }
    }
    
    let msg = `✨ *Regeneración de IDs completada*\n\n`;
    msg += `📊 *Resumen:*\n`;
    msg += `• IDs generados: ${actualizados}\n`;
    msg += `• Ya tenían ID: ${yaTenianId}\n`;
    msg += `• Total filas: ${filas.length}\n\n`;
    
    if (actualizados > 0) {
      msg += `✅ Los ${actualizados} movimientos ahora tienen ID único.\n`;
      msg += `Usa /listar para verificarlos.`;
    } else {
      msg += `💡 Todos los movimientos ya tenían ID.`;
    }
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /regenerar_ids:', error.message, error.stack);
    ctx.reply('❌ Error al regenerar IDs. Verifica los logs.');
  }
});

module.exports = {};
