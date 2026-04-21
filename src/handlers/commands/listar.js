const { bot } = require('../../lib/telegraf');
const { getSheetCliente } = require('../../services/sheet.service');

bot.command('listar', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando movimientos...');
    
    const sheet = await getSheetCliente(ctx.from.id);
    if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');
    
    const filas = await sheet.getRows();
    
    console.log('DEBUG /listar - Total filas:', filas.length);
    
    if (filas.length === 0) {
      return ctx.reply('📭 No hay movimientos en el sheet.');
    }
    
    if (filas.length > 0) {
      const primeraFila = filas[0].toObject ? filas[0].toObject() : filas[0];
      console.log('DEBUG /listar - Columnas:', Object.keys(primeraFila));
    }
    
    let msg = `📋 *Movimientos (últimos 10):*\n\n`;
    
    const ultimosMovimientos = filas.slice(-10).reverse();
    ultimosMovimientos.forEach((f, i) => {
      const desc = f.get('Descripcion') || f.get('descripcion') || f.get('Paciente') || f.get('paciente') || f.get('Nombre') || f.get('nombre') || 'Sin descripción';
      const monto = f.get('Monto') || f.get('monto') || '0';
      const fecha = f.get('Fecha') || f.get('fecha') || '';
      const id = f.get('ID_Unico') || f.get('ID_unico') || f.get('ID_uNico') || f.get('idunico') || 'sin-id';
      
      msg += `${i + 1}. ${desc}\n`;
      msg += `   $${monto} - ${fecha}\n`;
      msg += `   ID: \`${id}\`\n\n`;
    });
    
    msg += `\n💡 Usa /eliminar [nombre] para eliminar uno.`;
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /listar:', error.message, error.stack);
    ctx.reply('❌ Error al listar movimientos. Verifica los logs.');
  }
});

module.exports = {};
