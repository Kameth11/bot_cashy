const { bot } = require('../../lib/telegraf');
const { getSheetCliente } = require('../../services/sheet.service');
const { getRowEstado, getRowDescripcion, getRowIdUnico } = require('../../utils/sheet-row');

bot.command('cobrar', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1);
    await ctx.reply('⏳ Buscando...');

    const sheet = await getSheetCliente(ctx.from.id);
    if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');
    const filas = await sheet.getRows();

    const pendientes = filas.filter(f => getRowEstado(f) === 'Pendiente');

    if (pendientes.length === 0) {
      return ctx.reply('✅ No hay movimientos pendientes.');
    }

    let filaActual = null;

    if (args.length > 0 && args[0] === 'ultimo') {
      filaActual = pendientes[pendientes.length - 1];
    } else {
      const texto = ctx.message.text.replace('/cobrar', '').trim().toLowerCase();
      filaActual = pendientes.find(f =>
        getRowDescripcion(f, '').toLowerCase().includes(texto)
      );
      if (!filaActual && texto) {
        filaActual = pendientes.find(f =>
          getRowIdUnico(f, '').toLowerCase() === texto
        );
      }
    }

    if (!filaActual) {
      let msg = `⏳ *Movimientos pendientes:*\n\n`;
      pendientes.slice(-5).forEach((f, i) => {
        msg += `• ${getRowDescripcion(f, '')}\n`;
      });
      msg += `\nUsa: /cobrar [nombre]`;
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    filaActual.set('Estado', 'Cobrado');
    await filaActual.save();

    ctx.reply(
      `✅ *¡Marcado como cobrado!*\n\n` +
      `📝 ${getRowDescripcion(filaActual, '')}`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Error /cobrar:', error.message);
    ctx.reply('❌ Error al actualizar estado.');
  }
});

module.exports = {};
