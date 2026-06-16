const { bot } = require('../lib/telegraf');
const { Markup } = require('telegraf');
const { GoogleSpreadsheet, serviceAccountAuth } = require('../lib/google');
const state = require('../state');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const clienteService = require('../services/cliente.service');
const { invalidateCache } = require('../services/sheet.service');
const { formatMonto, escapeMarkdown } = require('../utils/formatter');
const { convertirAPesos } = require('../services/movimiento.service');
const { obtenerCotizacionDolar } = require('../services/cotizacion.service');
const { guardarTurnosAgenda, guardarTurnosFlat } = require('../services/agenda.service');
const { aplicarColorMontoEnFila } = require('../services/sheet-format.service');

function confirmButtons(confirmAction, cancelAction) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Confirmar', confirmAction),
      Markup.button.callback('❌ Cancelar', cancelAction)
    ]
  ]);
}

// ── Helper: construye el teclado de lista para /eliminar ──────────────────────
function buildDeleteListKeyboard(items, query) {
  const titulo = query
    ? `🗑️ *Resultados para "${escapeMarkdown(query)}"*\n\nElegí el movimiento:`
    : `🗑️ *Últimos movimientos*\n\nElegí el que querés eliminar:`;

  const filas = items.map((item, i) => {
    const desc = item.desc.length > 24 ? item.desc.substring(0, 24) + '…' : item.desc;
    const fechaCorta = item.fecha ? item.fecha.substring(0, 5) : '';
    const label = `${fechaCorta ? fechaCorta + ' · ' : ''}${desc} · ${formatMonto(item.monto, item.moneda)}`;
    return [Markup.button.callback(label, `del_pick_${i}`)];
  });
  filas.push([Markup.button.callback('❌ Cancelar', 'del_cancel')]);

  return { titulo, keyboard: Markup.inlineKeyboard(filas) };
}

// ── Selección de ítem de la lista de eliminar ─────────────────────────────────
bot.action(/^del_pick_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const index = parseInt(ctx.match[1]);

  const pending = state.pendingDeletes.get(userId);
  if (!pending || pending.type !== 'list') {
    return ctx.editMessageText('⚠️ Sesión expirada. Ejecutá /eliminar de nuevo.');
  }

  const item = pending.items[index];
  if (!item) return ctx.editMessageText('❌ Elemento no encontrado.');

  pending.step = 'confirm';
  pending.selectedIndex = index;
  state.pendingDeletes.set(userId, pending);

  const tipo = item.monto < 0 ? '📤 Egreso' : '📥 Ingreso';
  const msg =
    `⚠️ *¿Eliminar este movimiento?*\n\n` +
    `${tipo}\n` +
    `📝 ${escapeMarkdown(item.desc)}\n` +
    `💰 ${formatMonto(Math.abs(item.monto), item.moneda)}\n` +
    `📅 ${item.fecha || 'Sin fecha'}\n\n` +
    `_Esta acción no se puede deshacer_`;

  await ctx.editMessageText(msg, {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Sí, eliminar', 'del_conf'),
        Markup.button.callback('↩️ Volver', 'del_back'),
      ]
    ]).reply_markup,
  });
});

// ── Confirmar eliminación ─────────────────────────────────────────────────────
bot.action('del_conf', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingDeletes.get(userId);

  if (!pending || pending.type !== 'list' || pending.step !== 'confirm') {
    return ctx.editMessageText('⚠️ Sesión expirada. Ejecutá /eliminar de nuevo.');
  }

  const item = pending.items[pending.selectedIndex];
  state.pendingDeletes.delete(userId);

  try {
    await item.fila.delete();
    invalidateCache(userId);
    await ctx.editMessageText(
      `✅ *Eliminado*\n\n📝 ${escapeMarkdown(item.desc)}\n💰 ${formatMonto(Math.abs(item.monto), item.moneda)}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Error al eliminar desde lista:', err.message);
    await ctx.editMessageText('❌ Error al eliminar. Verificá los logs.');
  }
});

// ── Volver a la lista ─────────────────────────────────────────────────────────
bot.action('del_back', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingDeletes.get(userId);

  if (!pending || pending.type !== 'list') {
    return ctx.editMessageText('⚠️ Sesión expirada. Ejecutá /eliminar de nuevo.');
  }

  pending.step = 'select';
  pending.selectedIndex = null;
  state.pendingDeletes.set(userId, pending);

  const { titulo, keyboard } = buildDeleteListKeyboard(pending.items, pending.query);
  await ctx.editMessageText(titulo, { parse_mode: 'Markdown', ...keyboard });
});

// ── Cancelar lista de eliminar ────────────────────────────────────────────────
bot.action('del_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  state.pendingDeletes.delete(ctx.from.id);
  await ctx.editMessageText('❌ Cancelado.');
});

bot.action('confirm_delete', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;

  if (!state.pendingDeletes.has(userId)) {
    return ctx.editMessageText('⚠️ Esta acción ya fue procesada o expiró.');
  }

  const pending = state.pendingDeletes.get(userId);
  // Si el estado es del nuevo formato (lista), ignorar — lo maneja del_conf
  if (pending.type === 'list') {
    return ctx.editMessageText('⚠️ Usá los botones del mensaje anterior.');
  }

  const { fila, index, desc } = pending;
  state.pendingDeletes.delete(userId);

  try {
    await fila.delete();
    invalidateCache(userId);
    await ctx.editMessageText(
      '✅ *Movimiento eliminado*\n\n' + `📝 ${escapeMarkdown(desc)}`,
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
    await aplicarColorMontoEnFila(fila, fila.get('Monto'), fila.get('Estado'));

    await ctx.editMessageText(
      `✅ *Movimiento actualizado*\n\n` +
      `📝 ${escapeMarkdown(fila.get('Descripcion'))}\n` +
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
    const { guardados, errores, total, fechaStr, grupos = [] } = await guardarTurnosAgenda(userId, turnos);

    // Guardar en tab plana Turnos (consultable por fecha)
    try { await guardarTurnosFlat(userId, turnos); } catch (e) { console.error('guardarTurnosFlat:', e.message); }
    const huboErrores = errores > 0;

    await ctx.editMessageText(
      `${huboErrores ? '⚠️' : '✅'} *${guardados} turno${guardados !== 1 ? 's' : ''} guardado${guardados !== 1 ? 's' : ''} en tu Agenda*\n\n` +
      `📅 Fecha: ${fechaStr}\n` +
      `${huboErrores ? `❌ No se pudieron guardar ${errores} de ${total} turno${total !== 1 ? 's' : ''}\n` : ''}` +
      `${grupos.length > 0 ? `🗂️ Bloques: ${grupos.join(' | ')}\n` : ''}` +
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

// ── Edición de turno ──────────────────────────────────────────────────────────

const CAMPOS_TURNO = [
  { key: 'cliente',     label: 'Paciente' },
  { key: 'servicio',    label: 'Servicio' },
  { key: 'profesional', label: 'Profesional' },
  { key: 'hora',        label: 'Hora' },
];

function buildCamposKeyboard() {
  const botones = CAMPOS_TURNO.map(c => [Markup.button.callback(c.label, `agenda_edit_campo_${c.key}`)]);
  botones.push([Markup.button.callback('❌ Cancelar', 'agenda_edit_cancel')]);
  return Markup.inlineKeyboard(botones);
}

bot.action(/^agenda_edit_pick_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingTurnoEdits.get(userId);
  if (!pending) return ctx.editMessageText('⚠️ Sesión expirada. Ejecutá /editarturno de nuevo.');

  const index = parseInt(ctx.match[1]);
  const turno = pending.turnos[index];
  if (!turno) return ctx.editMessageText('❌ Turno no encontrado.');

  pending.turno = turno;
  pending.step = 'select_campo';
  state.pendingTurnoEdits.set(userId, pending);

  const hora = turno.hora ? turno.hora.substring(0, 5) : '??:??';
  await ctx.editMessageText(
    `✏️ *${hora} · ${turno.cliente || 'Sin nombre'}*\n\n¿Qué campo querés editar?`,
    { parse_mode: 'Markdown', ...buildCamposKeyboard() }
  );
});

bot.action(/^agenda_edit_campo_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingTurnoEdits.get(userId);
  if (!pending || !pending.turno) return ctx.editMessageText('⚠️ Sesión expirada. Ejecutá /editarturno de nuevo.');

  const key = ctx.match[1];
  const campo = CAMPOS_TURNO.find(c => c.key === key);
  if (!campo) return ctx.editMessageText('❌ Campo inválido.');

  pending.campo = campo;
  pending.step = 'ingresar_valor';
  state.pendingTurnoEdits.set(userId, pending);

  const valorActual = pending.turno[campo.key] || '(vacío)';
  await ctx.editMessageText(
    `✏️ *${campo.label}*\nValor actual: \`${valorActual}\`\n\nEscribí el nuevo valor:`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('agenda_edit_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  state.pendingTurnoEdits.delete(ctx.from.id);
  await ctx.editMessageText('❌ Edición cancelada.');
});

module.exports = { confirmButtons, buildDeleteListKeyboard };
