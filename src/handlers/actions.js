const { bot } = require('../lib/telegraf');
const { Markup } = require('telegraf');
const { crearDocumento } = require('../lib/google');
const state = require('../state');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const clienteService = require('../services/cliente.service');
const { invalidateCache } = require('../services/sheet.service');
const { formatMonto, escapeMarkdown } = require('../utils/formatter');
const { convertirAPesos } = require('../services/movimiento.service');
const { obtenerCotizacionDolar } = require('../services/cotizacion.service');
const { guardarAgendaParaFecha, detectarDuplicados } = require('../services/agenda.service');
const { fechaArgentinaStr, fechaMananaArgentinaStr, parsearFechaIngresada } = require('../utils/date');
const { aplicarColorMontoEnFila } = require('../services/sheet-format.service');
const { withUserWriteLock } = require('../lib/write-queue');
const textos = require('../messages');

function confirmButtons(confirmAction, cancelAction) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(textos.actions.confirmar, confirmAction),
      Markup.button.callback(textos.actions.cancelar, cancelAction)
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
  filas.push([Markup.button.callback(textos.actions.cancelar, 'del_cancel')]);

  return { titulo, keyboard: Markup.inlineKeyboard(filas) };
}

// ── Selección de ítem de la lista de eliminar ─────────────────────────────────
bot.action(/^del_pick_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const index = parseInt(ctx.match[1]);

  const pending = state.pendingDeletes.get(userId);
  if (!pending || pending.type !== 'list') {
    return ctx.editMessageText(textos.actions.sesionExpiradaEjecutaEliminarDe);
  }

  const item = pending.items[index];
  if (!item) return ctx.editMessageText(textos.actions.elementoNoEncontrado);

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
        Markup.button.callback(textos.actions.siEliminar, 'del_conf'),
        Markup.button.callback(textos.actions.volver, 'del_back'),
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
    return ctx.editMessageText(textos.actions.sesionExpiradaEjecutaEliminarDe);
  }

  const item = pending.items[pending.selectedIndex];
  state.pendingDeletes.delete(userId);

  try {
    await withUserWriteLock(userId, () => item.fila.delete());
    invalidateCache(userId);
    await ctx.editMessageText(
      textos.actions.movimientoEliminadoConMonto(escapeMarkdown(item.desc), formatMonto(Math.abs(item.monto), item.moneda)),
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Error al eliminar desde lista:', err.message);
    await ctx.editMessageText(textos.actions.errorAlEliminarVerificaLos);
  }
});

// ── Volver a la lista ─────────────────────────────────────────────────────────
bot.action('del_back', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingDeletes.get(userId);

  if (!pending || pending.type !== 'list') {
    return ctx.editMessageText(textos.actions.sesionExpiradaEjecutaEliminarDe);
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
  await ctx.editMessageText(textos.actions.cancelado);
});

bot.action('confirm_delete', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;

  if (!state.pendingDeletes.has(userId)) {
    return ctx.editMessageText(textos.actions.estaAccionYaFueProcesada);
  }

  const pending = state.pendingDeletes.get(userId);
  // Si el estado es del nuevo formato (lista), ignorar — lo maneja del_conf
  if (pending.type === 'list') {
    return ctx.editMessageText(textos.actions.usaLosBotonesDelMensaje);
  }

  const { fila, index, desc } = pending;
  state.pendingDeletes.delete(userId);

  try {
    await withUserWriteLock(userId, () => fila.delete());
    invalidateCache(userId);
    await ctx.editMessageText(
      textos.actions.movimientoEliminado(escapeMarkdown(desc)),
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error al eliminar:', error.message, error.stack);
    await ctx.editMessageText(textos.actions.errorAlEliminarMovimientoVerifica);
  }
});

bot.action('cancel_delete', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  state.pendingDeletes.delete(userId);
  await ctx.editMessageText(textos.actions.eliminacionCancelada);
});

bot.action('confirm_clean', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;

  if (!state.pendingLimpiezas.has(userId)) {
    return ctx.editMessageText(textos.actions.estaAccionYaFueProcesada);
  }

  const { filas } = state.pendingLimpiezas.get(userId);
  state.pendingLimpiezas.delete(userId);

  try {
    await ctx.editMessageText(textos.actions.eliminandoFilas);
    let eliminadas = 0;
    let errores = 0;

    await withUserWriteLock(userId, async () => {
      for (const item of filas) {
        try {
          await item.fila.delete();
          eliminadas++;
        } catch (error) {
          errores++;
          console.error(`Error al eliminar fila #${item.index + 1}:`, error.message);
        }
      }
    });

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
    await ctx.editMessageText(textos.actions.errorDuranteLaLimpiezaIntenta);
  }
});

bot.action('cancel_clean', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  state.pendingLimpiezas.delete(userId);
  await ctx.editMessageText(textos.actions.limpiezaCanceladaNingunaFilaFue);
});

bot.action('confirm_reset', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;

  if (!state.pendingReinicios.has(userId)) {
    return ctx.editMessageText(textos.actions.estaAccionYaFueProcesada);
  }

  state.pendingReinicios.delete(userId);
  const cliente = obtenerClientePorUserId(userId);

  // eliminarCliente (no un delete manual + guardarClientes) porque también
  // borra la fila en Supabase y saca al usuario de usuarios[] si en algún
  // momento quedó como invitado de otra cuenta — guardarClientes solo hace
  // upserts, nunca deletes.
  await clienteService.eliminarCliente(userId);

  if (cliente && cliente.sheetId) {
    try {
      const docToClear = crearDocumento(cliente.sheetId);
      await docToClear.loadInfo();
      const sheetToClear = docToClear.sheetsByIndex[0];
      const rows = await sheetToClear.getRows();
      await withUserWriteLock(userId, async () => {
        for (const row of rows) {
          await row.delete();
        }
      });
      await ctx.editMessageText(
        textos.actions.registroReiniciadoConSheet,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Error al limpiar sheet:', error.message);
      await ctx.editMessageText(
        textos.actions.registroReiniciadoSheetSinLimpiar,
        { parse_mode: 'Markdown' }
      );
    }
  } else {
    await ctx.editMessageText(
      textos.actions.registroReiniciadoSinSheet,
      { parse_mode: 'Markdown' }
    );
  }
});

bot.action('cancel_reset', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  state.pendingReinicios.delete(userId);
  await ctx.editMessageText(textos.actions.reinicioCancelado);
});

bot.action('confirm_edit', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;

  if (!state.pendingEdits.has(userId)) {
    return ctx.editMessageText(textos.actions.estaAccionYaFueProcesada);
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
    await withUserWriteLock(userId, async () => {
      await fila.save();
      await aplicarColorMontoEnFila(fila, fila.get('Monto'), fila.get('Estado'));
    });

    await ctx.editMessageText(
      textos.actions.movimientoActualizado(
        escapeMarkdown(fila.get('Descripcion')),
        formatMonto(parseFloat(fila.get('Monto')), editData.moneda)
      ),
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error al editar:', error.message);
    await ctx.editMessageText(textos.actions.errorAlGuardarCambios);
  }
});

bot.action('cancel_edit', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  state.pendingEdits.delete(userId);
  await ctx.editMessageText(textos.actions.edicionCancelada);
});

function fechaPickerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(textos.actions.hoy, 'agenda_fecha_hoy'), Markup.button.callback(textos.actions.manana, 'agenda_fecha_manana')],
    [Markup.button.callback(textos.actions.otraFecha, 'agenda_fecha_otra')],
    [Markup.button.callback(textos.actions.cancelar, 'cancel_agenda')],
  ]);
}

bot.action('confirm_agenda', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;

  if (!state.pendingAgendaConfirm.has(userId)) {
    return ctx.editMessageText(textos.actions.estaAccionYaFueProcesada);
  }

  const { turnos } = state.pendingAgendaConfirm.get(userId);
  state.pendingAgendaConfirm.delete(userId);
  state.pendingAgendaFecha.set(userId, { turnos });

  await ctx.editMessageText(textos.actions.paraQueDiaEsEsta, {
    parse_mode: 'Markdown',
    ...fechaPickerKeyboard(),
  });
});

bot.action('cancel_agenda', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  state.pendingAgendaConfirm.delete(userId);
  state.pendingAgendaFecha.delete(userId);
  state.pendingAgendaDuplicados.delete(userId);
  await ctx.editMessageText(textos.actions.turnosDescartados);
});

// Punto único de guardado una vez que ya se sabe la fecha: detecta duplicados
// (misma hora + paciente normalizado) contra lo ya cargado para esa fecha y,
// si encuentra alguno, pregunta si reemplazar o agregar antes de escribir.
// La usan tanto los botones Hoy/Mañana como el texto libre de "Otra fecha"
// (ver handlers/text.js).
async function procesarFechaAgendaElegida(ctx, userId, turnos, fecha) {
  state.pendingAgendaFecha.delete(userId);

  try {
    const duplicados = await detectarDuplicados(userId, turnos, fecha);

    if (duplicados.length === 0) {
      await ctx.reply(textos.actions.guardandoTurnosEnAgenda);
      const { guardados, fechaStr } = await guardarAgendaParaFecha(userId, turnos, fecha);
      return ctx.reply(
        textos.actions.turnosGuardados(guardados, fechaStr),
        { parse_mode: 'Markdown' }
      );
    }

    state.pendingAgendaDuplicados.set(userId, { turnos, fecha, duplicados });
    const nombres = duplicados
      .map(d => escapeMarkdown(d.existente.cliente || d.existente.hora))
      .join(', ');
    return ctx.reply(
      textos.actions.turnosDuplicados(duplicados.length, fecha, nombres),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(textos.actions.reemplazarDuplicados, 'agenda_dup_reemplazar')],
          [Markup.button.callback(textos.actions.agregarTodo, 'agenda_dup_agregar')],
          [Markup.button.callback(textos.actions.cancelar, 'cancel_agenda')],
        ]),
      }
    );
  } catch (error) {
    console.error('Error al guardar agenda:', error.message);
    return ctx.reply(textos.actions.errorAlGuardarLosTurnos);
  }
}

bot.action('agenda_fecha_hoy', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingAgendaFecha.get(userId);
  if (!pending) return ctx.editMessageText(textos.actions.estaAccionYaFueProcesada);
  await ctx.editMessageText(textos.actions.procesando);
  await procesarFechaAgendaElegida(ctx, userId, pending.turnos, fechaArgentinaStr());
});

bot.action('agenda_fecha_manana', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingAgendaFecha.get(userId);
  if (!pending) return ctx.editMessageText(textos.actions.estaAccionYaFueProcesada);
  await ctx.editMessageText(textos.actions.procesando);
  await procesarFechaAgendaElegida(ctx, userId, pending.turnos, fechaMananaArgentinaStr());
});

bot.action('agenda_fecha_otra', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingAgendaFecha.get(userId);
  if (!pending) return ctx.editMessageText(textos.actions.estaAccionYaFueProcesada);
  state.pendingAgendaFecha.set(userId, { turnos: pending.turnos, esperandoTexto: true });
  await ctx.editMessageText(textos.actions.escribiLaFechaDdMm);
});

bot.action('agenda_dup_reemplazar', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingAgendaDuplicados.get(userId);
  if (!pending) return ctx.editMessageText(textos.actions.estaAccionYaFueProcesada);
  state.pendingAgendaDuplicados.delete(userId);

  try {
    await ctx.editMessageText(textos.actions.guardandoTurnosEnAgenda);
    const idsAEliminar = pending.duplicados.map(d => d.existente.idTurno).filter(Boolean);
    const { guardados, fechaStr } = await guardarAgendaParaFecha(userId, pending.turnos, pending.fecha, { idsAEliminar });
    await ctx.editMessageText(
      textos.actions.turnosGuardados(guardados, fechaStr, idsAEliminar.length),
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error al guardar agenda:', error.message);
    await ctx.editMessageText(textos.actions.errorAlGuardarLosTurnos);
  }
});

bot.action('agenda_dup_agregar', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingAgendaDuplicados.get(userId);
  if (!pending) return ctx.editMessageText(textos.actions.estaAccionYaFueProcesada);
  state.pendingAgendaDuplicados.delete(userId);

  try {
    await ctx.editMessageText(textos.actions.guardandoTurnosEnAgenda);
    const { guardados, fechaStr } = await guardarAgendaParaFecha(userId, pending.turnos, pending.fecha);
    await ctx.editMessageText(
      textos.actions.turnosGuardados(guardados, fechaStr),
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error al guardar agenda:', error.message);
    await ctx.editMessageText(textos.actions.errorAlGuardarLosTurnos);
  }
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
  botones.push([Markup.button.callback(textos.actions.cancelar, 'agenda_edit_cancel')]);
  return Markup.inlineKeyboard(botones);
}

bot.action(/^agenda_edit_pick_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingTurnoEdits.get(userId);
  if (!pending) return ctx.editMessageText(textos.actions.sesionExpiradaEjecutaEditarturnoDe);

  const index = parseInt(ctx.match[1]);
  const turno = pending.turnos[index];
  if (!turno) return ctx.editMessageText(textos.actions.turnoNoEncontrado);

  const hora = turno.hora ? turno.hora.substring(0, 5) : '??:??';
  try {
    await ctx.editMessageText(
      textos.actions.editarTurnoPregunta(escapeMarkdown(hora), escapeMarkdown(turno.cliente || textos.actions.turnoSinNombre)),
      { parse_mode: 'Markdown', ...buildCamposKeyboard() }
    );
  } catch (error) {
    console.error('Error en agenda_edit_pick:', error.message);
    return ctx.editMessageText(textos.actions.errorAlMostrarElTurno).catch(() => {});
  }

  // El estado se setea DESPUÉS de que el envío salga bien (ver photo.js
  // para el mismo criterio): si no, un turno con _ o * en el nombre rompía
  // el mensaje y dejaba pendingTurnoEdits seteado sin que el usuario viera
  // nunca el teclado de "¿Qué campo querés editar?".
  pending.turno = turno;
  pending.step = 'select_campo';
  state.pendingTurnoEdits.set(userId, pending);
});

bot.action(/^agenda_edit_campo_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingTurnoEdits.get(userId);
  if (!pending || !pending.turno) return ctx.editMessageText(textos.actions.sesionExpiradaEjecutaEditarturnoDe);

  const key = ctx.match[1];
  const campo = CAMPOS_TURNO.find(c => c.key === key);
  if (!campo) return ctx.editMessageText(textos.actions.campoInvalido);

  pending.campo = campo;
  pending.step = 'ingresar_valor';
  state.pendingTurnoEdits.set(userId, pending);

  const valorActual = pending.turno[campo.key] || textos.actions.campoVacio;
  await ctx.editMessageText(
    textos.actions.campoValorActual(campo.label, valorActual),
    { parse_mode: 'Markdown' }
  );
});

bot.action('agenda_edit_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  state.pendingTurnoEdits.delete(ctx.from.id);
  await ctx.editMessageText(textos.actions.edicionCancelada);
});

module.exports = { confirmButtons, buildDeleteListKeyboard, procesarFechaAgendaElegida };
