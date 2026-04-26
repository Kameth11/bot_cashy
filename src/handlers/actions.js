const { bot } = require('../lib/telegraf');
const { Markup } = require('telegraf');
const { GoogleSpreadsheet, serviceAccountAuth } = require('../lib/google');
const state = require('../state');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const clienteService = require('../services/cliente.service');
const { invalidateCache } = require('../services/sheet.service');
const { formatMonto } = require('../utils/formatter');
const { convertirAPesos } = require('../services/movimiento.service');
const { obtenerCotizacionDolar } = require('../services/cotizacion.service');
const { guardarTurnosAgenda } = require('../services/agenda.service');

function confirmButtons(confirmAction, cancelAction) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Confirmar', confirmAction),
      Markup.button.callback('❌ Cancelar', cancelAction)
    ]
  ]);
}

bot.action('confirm_delete', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;

  if (!state.pendingDeletes.has(userId)) {
    return ctx.editMessageText('⚠️ Esta acción ya fue procesada o expiró.');
  }

  const { fila, index, desc } = state.pendingDeletes.get(userId);
  state.pendingDeletes.delete(userId);

  try {
    await fila.delete();
    invalidateCache(userId);
    await ctx.editMessageText(
      '✅ *Movimiento eliminado*\n\n' + `📝 ${desc}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error al eliminar:', error.message, error.stack);
    await ctx.editMessageText('❌ Error al eliminar movimiento. Verifica los logs.');
  }
});

bot.action('cancel_delete', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  state.pendingDeletes.delete(userId);
  await ctx.editMessageText('❌ Eliminación cancelada.');
});

bot.action('confirm_clean', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;

  if (!state.pendingLimpiezas.has(userId)) {
    return ctx.editMessageText('⚠️ Esta acción ya fue procesada o expiró.');
  }

  const { filas } = state.pendingLimpiezas.get(userId);
  state.pendingLimpiezas.delete(userId);

  try {
    await ctx.editMessageText('⏳ Eliminando filas...');
    let eliminadas = 0;
    let errores = 0;

    for (const item of filas) {
      try {
        await item.fila.delete();
        eliminadas++;
      } catch (error) {
        errores++;
        console.error(`Error al eliminar fila #${item.index + 1}:`, error.message);
      }
    }

    invalidateCache(userId);

    let msg = `✅ *LIMPIEZA COMPLETADA*\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `✅ Eliminadas: ${eliminadas} filas\n`;
    if (errores > 0) {
      msg += `❌ Errores: ${errores}\n`;
    }
    msg += `\n💡 Usa /debug para verificar que todo esté limpio.`;

    await ctx.editMessageText(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error en limpieza:', error.message, error.stack);
    await ctx.editMessageText('❌ Error durante la limpieza. Intenta de nuevo.');
  }
});

bot.action('cancel_clean', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  state.pendingLimpiezas.delete(userId);
  await ctx.editMessageText('✅ Limpieza cancelada. Ninguna fila fue eliminada.');
});

bot.action('confirm_reset', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;

  if (!state.pendingReinicios.has(userId)) {
    return ctx.editMessageText('⚠️ Esta acción ya fue procesada o expiró.');
  }

  state.pendingReinicios.delete(userId);
  const cliente = obtenerClientePorUserId(userId);

  const clientes = clienteService.clientes;
  delete clientes[userId];
  await clienteService.guardarClientes(clientes);

  if (cliente && cliente.sheetId) {
    try {
      const docToClear = new GoogleSpreadsheet(cliente.sheetId, serviceAccountAuth);
      await docToClear.loadInfo();
      const sheetToClear = docToClear.sheetsByIndex[0];
      const rows = await sheetToClear.getRows();
      for (const row of rows) {
        await row.delete();
      }
      await ctx.editMessageText(
        '✅ *Registro reiniciado*\n\n' +
        'Se borraron:\n' +
        '• Tus datos locales\n' +
        '• Todos los movimientos del sheet\n\n' +
        'Usa /start para registrarte de nuevo.',
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Error al limpiar sheet:', error.message);
      await ctx.editMessageText(
        '✅ *Registro reiniciado*\n\n' +
        'Se borraron tus datos locales.\n' +
        '⚠️ No se pudo limpiar el sheet (verifica que esté compartido).\n\n' +
        'Usa /start para registrarte de nuevo.',
        { parse_mode: 'Markdown' }
      );
    }
  } else {
    await ctx.editMessageText(
      '✅ *Registro reiniciado*\n\n' +
      'Tus datos han sido borrados.\n' +
      'No tenías sheet configurado.\n\n' +
      'Usa /start para registrarte de nuevo.',
      { parse_mode: 'Markdown' }
    );
  }
});

bot.action('cancel_reset', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  state.pendingReinicios.delete(userId);
  await ctx.editMessageText('❌ Reinicio cancelado.');
});

bot.action('confirm_edit', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;

  if (!state.pendingEdits.has(userId)) {
    return ctx.editMessageText('⚠️ Esta acción ya fue procesada o expiró.');
  }

  const editData = state.pendingEdits.get(userId);
  state.pendingEdits.delete(userId);

  try {
    if (editData.moneda === 'Dólares' && !state.cotizacionDolar) {
      await obtenerCotizacionDolar();
    }

    const fila = editData.fila;
    if (editData.descripcion !== editData.descripcionOriginal) {
      fila.set('Descripcion', editData.descripcion);
    }
    if (editData.nuevoMonto !== editData.montoOriginal) {
      fila.set('Monto', editData.nuevoMonto);
      if (editData.moneda === 'Dólares') {
        fila.set('MontoPesos', convertirAPesos(editData.nuevoMonto, editData.moneda));
      }
    }
    await fila.save();

    await ctx.editMessageText(
      `✅ *Movimiento actualizado*\n\n` +
      `📝 ${fila.get('Descripcion')}\n` +
      `💰 ${formatMonto(parseFloat(fila.get('Monto')), editData.moneda)}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error al editar:', error.message);
    await ctx.editMessageText('❌ Error al guardar cambios.');
  }
});

bot.action('cancel_edit', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  state.pendingEdits.delete(userId);
  await ctx.editMessageText('❌ Edición cancelada.');
});

bot.action('confirm_agenda', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;

  if (!state.pendingAgendaConfirm.has(userId)) {
    return ctx.editMessageText('⚠️ Esta acción ya fue procesada o expiró.');
  }

  const { turnos } = state.pendingAgendaConfirm.get(userId);
  state.pendingAgendaConfirm.delete(userId);

  try {
    await ctx.editMessageText('⏳ Guardando turnos en Agenda...');
    const { guardados, fechaStr } = await guardarTurnosAgenda(userId, turnos);

    await ctx.editMessageText(
      `✅ *${guardados} turno${guardados !== 1 ? 's' : ''} guardado${guardados !== 1 ? 's' : ''} en tu Agenda*\n\n` +
      `📅 Fecha: ${fechaStr}\n` +
      `📊 Ver en tu Google Sheet (tab "Agenda")`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error al guardar agenda:', error.message);
    await ctx.editMessageText('❌ Error al guardar los turnos en la agenda.');
  }
});

bot.action('cancel_agenda', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  state.pendingAgendaConfirm.delete(userId);
  await ctx.editMessageText('❌ Turnos descartados.');
});

module.exports = { confirmButtons };
