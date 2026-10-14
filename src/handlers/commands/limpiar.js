const { bot } = require('../../lib/telegraf');
const { getSheetId, getSheetCliente } = require('../../services/sheet.service');
const state = require('../../state');
const { confirmButtons } = require('../actions');
const { toMovimiento, isValidMovimientoRow, getRowMontoRaw } = require('../../utils/sheet-row');
const { requiereDuenoBot } = require('../../auth/bot-permisos');
const textos = require('../../messages');

bot.command('limpiar', async (ctx) => {
  if (!requiereDuenoBot(ctx, '/limpiar')) return;
  try {
    const userId = ctx.from.id;
    const sheetId = getSheetId(userId);

    if (!sheetId) {
      return ctx.reply(textos.comandos.limpiar.noTienesUnSheetConfigurado);
    }

    await ctx.reply(textos.comandos.limpiar.limpiezaDelSheetAnalizandoFilas);

    const sheet = await getSheetCliente(userId);
    const filasRaw = await sheet.getRows();
    const totalFilas = filasRaw.length;

    const filasInvalidas = [];
    
    filasRaw.forEach((fila, index) => {
      if (!isValidMovimientoRow(fila)) {
        filasInvalidas.push({ fila, index });
      }
    });

    if (filasInvalidas.length === 0) {
      return ctx.reply(textos.comandos.limpiar.todoLimpioNoHayFilas);
    }

    state.pendingLimpiezas.set(userId, { filas: filasInvalidas, sheet });

    let msg = `🧹 *FILAS A ELIMINAR*\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📊 Total filas: ${totalFilas}\n`;
    msg += `❌ Filas inválidas: ${filasInvalidas.length}\n\n`;
    msg += `*Detalles:*\n`;

    if (filasInvalidas.length <= 10) {
      filasInvalidas.forEach((item, i) => {
        const rowObj = toMovimiento(item.fila);
        const fecha = rowObj.fecha || '(vacía)';
        const desc = rowObj.descripcion || '(vacía)';
        const monto = getRowMontoRaw(item.fila, '0');
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

    msg += `\n\n⚠️ *¿Confirmas la eliminación?*`;

    await ctx.reply(msg, {
      parse_mode: 'Markdown',
      ...confirmButtons('confirm_clean', 'cancel_clean')
    });

  } catch (error) {
    console.error('Error /limpiar:', error.message, error.stack);
    await ctx.reply(textos.comandos.limpiar.errorAlAnalizarElSheet);
  }
});

module.exports = {};
