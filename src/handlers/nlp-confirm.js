const { Markup } = require('telegraf');
const { bot } = require('../lib/telegraf');
const state = require('../state');
const cmd = require('../services/command.service');
const { escapeMarkdown, formatMonto } = require('../utils/formatter');
const { DASHBOARD_URL } = require('../config');

// ── Formatting ───────────────────────────────────────────────────────────────

function formatMontoConMoneda(monto, moneda) {
  if (!monto) return '—';
  if (moneda === 'Euros') return `€${Math.abs(monto).toLocaleString('es-AR')}`;
  return formatMonto(monto, moneda);
}

function esAmbitoPersonal(entities) {
  return String((entities || {}).ambito || '').toLowerCase() === 'personal';
}

function crearMensajeConfirmacion(entities) {
  const es = entities || {};
  const tipoRaw = String(es.tipo || '').toLowerCase();
  const esEgreso = ['gasto', 'egreso'].includes(tipoRaw);
  const tipoTexto = esEgreso ? 'Egreso 🔴' : 'Ingreso 💚';

  const moneda = es.moneda || 'Pesos';
  const montoTexto = formatMontoConMoneda(es.monto, moneda);
  const monedaLabel = moneda === 'Dólares' ? ' dólares' : moneda === 'Euros' ? ' euros' : ' pesos';

  const estadoTexto = es.estado === 'Pendiente' ? 'Pendiente ⏳' : 'Cobrado';
  const metodo = es.metodo_pago
    ? es.metodo_pago.charAt(0).toUpperCase() + es.metodo_pago.slice(1)
    : null;

  const v = (x) => (x ? escapeMarkdown(String(x)) : '—');
  const categoriaTexto = es.categoria ? escapeMarkdown(String(es.categoria).replace(/_/g, ' ')) : '—';

  // El ámbito personal tiene otros campos: no hay paciente ni tratamiento, y
  // sí importan la categoría y el viaje al que se atribuye.
  if (esAmbitoPersonal(es)) {
    const viajeLinea = es.viajeNombre
      ? `• Viaje: ✈️ ${escapeMarkdown(String(es.viajeNombre))}\n`
      : '';
    return (
      `📋 *Entendí esto:*\n\n` +
      `• Ámbito: 🏠 Personal\n` +
      `• Tipo: ${tipoTexto}\n` +
      `• Monto: ${montoTexto}${es.monto ? monedaLabel : ''}\n` +
      `• Categoría: ${categoriaTexto}\n` +
      `• Detalle: ${v(es.descripcion)}\n` +
      `• Método: ${v(metodo)}\n` +
      viajeLinea +
      `\n_¿Es correcto?_`
    );
  }

  const nombreLabel = esEgreso ? 'Proveedor' : 'Paciente';
  const nombreValor = esEgreso ? es.proveedorNombre : es.pacienteNombre;

  // Cuando el término es ambiguo (alquiler, luz, expensas...) se avisa, porque
  // el default es consultorio y quizá no sea lo que el usuario quiso.
  const avisoAmbiguo = es.ambiguoAmbito
    ? `\n⚠️ _Asumí que es del consultorio. Si es de tu casa, tocá el botón._\n`
    : '';

  return (
    `📋 *Entendí esto:*\n\n` +
    `• Ámbito: 🏥 Consultorio\n` +
    `• Tipo: ${tipoTexto}\n` +
    `• Monto: ${montoTexto}${es.monto ? monedaLabel : ''}\n` +
    `• ${nombreLabel}: ${v(nombreValor)}\n` +
    `• Método: ${v(metodo)}\n` +
    `• Estado: ${estadoTexto}\n` +
    `• Tratamiento: ${v(es.tratamientoNombre)}\n` +
    avisoAmbiguo +
    `\n_¿Es correcto?_`
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

function confirmationButtons(entities) {
  const personal = esAmbitoPersonal(entities);
  const filas = [
    [
      Markup.button.callback('✅ Guardar', 'nlp_save'),
      Markup.button.callback('❌ Cancelar', 'nlp_cancel'),
    ],
    [
      Markup.button.callback(
        personal ? '🏥 Es del consultorio' : '🏠 Es personal',
        'nlp_toggle_ambito'
      ),
    ],
  ];

  // Un gasto atribuido a un viaje se puede desatribuir sin tocar nada más: es
  // el caso de pagar la luz mientras estás de viaje.
  if (personal && (entities || {}).viajeId) {
    filas.push([Markup.button.callback('🚫 No es del viaje', 'nlp_quitar_viaje')]);
  }

  filas.push([Markup.button.callback('✏️ Editar un campo', 'nlp_edit')]);
  return Markup.inlineKeyboard(filas);
}

function editFieldButtons() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💰 Monto', 'nlp_edit_monto'),
      Markup.button.callback('👤 Paciente', 'nlp_edit_paciente'),
    ],
    [
      Markup.button.callback('💳 Método', 'nlp_edit_metodo'),
      Markup.button.callback('📊 Tipo', 'nlp_edit_tipo'),
    ],
    [
      Markup.button.callback('📋 Estado', 'nlp_edit_estado'),
      Markup.button.callback('🔄 Reescribir', 'nlp_edit_reescribir'),
    ],
  ]);
}

function discardButtons() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Guardar', 'nlp_keep_old'),
      Markup.button.callback('❌ Descartar', 'nlp_discard_old'),
    ],
  ]);
}

// ── Public API ───────────────────────────────────────────────────────────────

async function mostrarConfirmacion(ctx, entities) {
  const userId = ctx.from.id;
  state.pendingNlpMovimientos.set(userId, { entities, editingCampo: null });
  await ctx.reply(crearMensajeConfirmacion(entities), {
    parse_mode: 'Markdown',
    ...confirmationButtons(entities),
  });
}

async function actualizarCampoNlp(ctx, userId, pending, text) {
  const campo = pending.editingCampo;
  const entities = { ...pending.entities };

  switch (campo) {
    case 'monto': {
      // Accept "15000", "15.000", "15,000" — strip thousands separators then parse
      const clean = String(text).trim().replace(/\./g, '').replace(',', '.');
      const n = parseFloat(clean);
      if (!Number.isFinite(n) || n <= 0) {
        return ctx.reply('⚠️ Monto inválido. Ingresá un número positivo (ej: 15000):');
      }
      entities.monto = n;
      break;
    }
    case 'pacienteNombre':
      entities.pacienteNombre = text.trim() || null;
      break;
    case 'metodo_pago': {
      const m = text.toLowerCase().trim();
      if (!['efectivo', 'transferencia', 'tarjeta'].includes(m)) {
        return ctx.reply('⚠️ Método inválido. Usá: efectivo / transferencia / tarjeta');
      }
      entities.metodo_pago = m;
      break;
    }
    case 'tipo': {
      const t = text.toLowerCase().trim();
      if (['ingreso', 'cobro', 'entrada', 'servicio', 'consulta'].includes(t)) {
        entities.tipo = 'ingreso';
      } else if (['gasto', 'egreso', 'salida'].includes(t)) {
        entities.tipo = 'gasto';
      } else {
        return ctx.reply('⚠️ Tipo inválido. Usá: ingreso / gasto');
      }
      break;
    }
    case 'estado': {
      const e = text.toLowerCase().trim();
      if (['cobrado', 'si', 'sí', 'pagado'].includes(e)) {
        entities.estado = 'Cobrado';
      } else if (['pendiente', 'no', 'sin cobrar'].includes(e)) {
        entities.estado = 'Pendiente';
      } else {
        return ctx.reply('⚠️ Estado inválido. Usá: cobrado / pendiente');
      }
      break;
    }
    default:
      break;
  }

  state.pendingNlpMovimientos.set(userId, { entities, editingCampo: null });
  return ctx.reply(crearMensajeConfirmacion(entities), {
    parse_mode: 'Markdown',
    ...confirmationButtons(entities),
  });
}

// ── Ámbito personal ──────────────────────────────────────────────────────────

async function guardarMovimientoPersonalDesdeConfirmacion(ctx, userId, entities) {
  const personalService = require('../services/personal.service');

  try {
    const { movimiento, viaje } = await personalService.registrarMovimientoPersonal(userId, {
      descripcion: entities.descripcion,
      monto: entities.monto,
      tipo: entities.tipo,
      moneda: entities.moneda,
      metodoPago: entities.metodo_pago,
      categoria: entities.categoria,
      comercio: entities.comercio || null,
      fecha: entities.fecha || undefined,
      // Pasar la clave explícitamente hace que el servicio NO recalcule la
      // atribución: así "No es del viaje" efectivamente guarda sin viaje.
      viajeId: entities.viajeId || null,
    });

    const categoriaTexto = escapeMarkdown(String(movimiento.categoria || '').replace(/_/g, ' '));
    const viajeTexto = viaje ? `\n✈️ Viaje: ${escapeMarkdown(viaje.nombre)}` : '';

    // Aviso de presupuesto: solo para egresos y solo si hay uno definido.
    let alerta = '';
    if (String(movimiento.tipo).toLowerCase() === 'egreso') {
      const estado = await personalService.evaluarPresupuesto(userId, movimiento.categoria, movimiento.fecha);
      if (estado && estado.enAlerta) {
        const icono = estado.excedido ? '🔴' : '⚠️';
        alerta =
          `\n\n${icono} *${categoriaTexto}*: ${formatMonto(estado.gastado, estado.moneda)} ` +
          `de ${formatMonto(estado.limite, estado.moneda)} (${estado.porcentaje}%)` +
          (estado.excedido
            ? `\n_Te pasaste del presupuesto del mes._`
            : `\n_Te quedan ${formatMonto(estado.restante, estado.moneda)} este mes._`);
      }
    }

    const extra = { parse_mode: 'Markdown' };
    if (DASHBOARD_URL) extra.reply_markup = { inline_keyboard: [[{ text: '📊 Ver Dashboard', url: DASHBOARD_URL }]] };

    return ctx.editMessageText(
      `✅ *Gasto personal registrado*\n\n` +
      `🏠 ${escapeMarkdown(movimiento.descripcion)}\n` +
      `💰 ${formatMonto(movimiento.monto, movimiento.moneda)}\n` +
      `🏷️ ${categoriaTexto}${viajeTexto}${alerta}`,
      extra
    );
  } catch (error) {
    if (error.message === 'monto_invalido') {
      return ctx.editMessageText('⚠️ El monto no es válido. Mandá el movimiento de nuevo.');
    }
    if (error.message === 'descripcion_invalida') {
      return ctx.editMessageText('⚠️ Falta una descripción más clara. Mandalo de nuevo.');
    }
    console.error('Error al guardar movimiento personal:', error.message);
    return ctx.editMessageText('❌ Error al guardar el gasto personal. Intentá de nuevo.');
  }
}

// Alterna consultorio <-> personal y RECUERDA la elección: la próxima vez que
// aparezca ese término ambiguo ya arranca en el ámbito correcto.
async function handleNlpToggleAmbito(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingNlpMovimientos.get(userId);
  if (!pending) return ctx.editMessageText('⚠️ El movimiento expiró. Mandalo de nuevo.');

  const personalService = require('../services/personal.service');
  const { inferirCategoriaPersonal } = require('../services/personal-nlp.service');

  const entities = { ...pending.entities };
  const nuevoAmbito = esAmbitoPersonal(entities) ? 'consultorio' : 'personal';
  entities.ambito = nuevoAmbito;
  entities.ambiguoAmbito = false;

  if (nuevoAmbito === 'personal') {
    entities.categoriaConsultorio = entities.categoria;
    entities.categoria = inferirCategoriaPersonal(
      entities.tipo,
      `${entities.descripcion || ''} ${entities.textoOriginal || ''}`
    );

    const viaje = await personalService.obtenerViajeActivo(userId);
    if (viaje && personalService.correspondeAlViaje(viaje, {
      fecha: entities.fecha || personalService.fechaHoyStr(),
      categoria: entities.categoria,
    })) {
      entities.viajeId = viaje.idViaje;
      entities.viajeNombre = viaje.nombre;
    }
  } else {
    // Volviendo al consultorio: se restaura la categoría clínica original.
    entities.categoria = entities.categoriaConsultorio || null;
    entities.viajeId = null;
    entities.viajeNombre = null;
  }

  // Aprender la corrección para no volver a preguntar por este término.
  if (entities.terminoAmbito) {
    await personalService.guardarPreferencia(userId, entities.terminoAmbito, nuevoAmbito);
  }

  state.pendingNlpMovimientos.set(userId, { entities, editingCampo: null });
  return ctx.editMessageText(crearMensajeConfirmacion(entities), {
    parse_mode: 'Markdown',
    ...confirmationButtons(entities),
  });
}

async function handleNlpQuitarViaje(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingNlpMovimientos.get(userId);
  if (!pending) return ctx.editMessageText('⚠️ El movimiento expiró. Mandalo de nuevo.');

  const entities = { ...pending.entities, viajeId: null, viajeNombre: null };
  state.pendingNlpMovimientos.set(userId, { entities, editingCampo: null });
  return ctx.editMessageText(crearMensajeConfirmacion(entities), {
    parse_mode: 'Markdown',
    ...confirmationButtons(entities),
  });
}

// ── Action handlers (exported for testing) ────────────────────────────────────

async function handleNlpSave(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingNlpMovimientos.get(userId);
  if (!pending) {
    return ctx.editMessageText('⚠️ El movimiento expiró. Mandalo de nuevo.');
  }
  state.pendingNlpMovimientos.delete(userId);

  // El ámbito personal tiene su propio almacenamiento (pestañas aparte) y no
  // pasa por el modelo del consultorio.
  if (esAmbitoPersonal(pending.entities)) {
    return guardarMovimientoPersonalDesdeConfirmacion(ctx, userId, pending.entities);
  }

  try {
    const resultado = await cmd.registrarMovimientoDesdeNLP(userId, pending.entities);
    if (resultado.necesitaInfo) {
      await ctx.editMessageText('⏳ Completando datos...');
      return ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' });
    }
    if (resultado.success) {
      const extra = { parse_mode: 'Markdown' };
      if (DASHBOARD_URL) extra.reply_markup = { inline_keyboard: [[{ text: '📊 Ver Dashboard', url: DASHBOARD_URL }]] };
      return ctx.editMessageText(resultado.mensaje, extra);
    }
    return ctx.editMessageText('❌ No se pudo registrar. Intentá de nuevo.');
  } catch (error) {
    console.error('Error al guardar NLP:', error.message);
    return ctx.editMessageText('❌ Error al guardar. Intentá de nuevo.');
  }
}

async function handleNlpCancel(ctx) {
  await ctx.answerCbQuery();
  state.pendingNlpMovimientos.delete(ctx.from.id);
  return ctx.editMessageText('❌ Cancelado. Podés volver a escribirlo cuando quieras.');
}

async function handleNlpEdit(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  if (!state.pendingNlpMovimientos.has(userId)) {
    return ctx.editMessageText('⚠️ El movimiento expiró. Mandalo de nuevo.');
  }
  return ctx.editMessageText('✏️ *¿Qué campo querés editar?*', {
    parse_mode: 'Markdown',
    ...editFieldButtons(),
  });
}

function makeEditCampoHandler(campo, prompt) {
  return async function handleNlpEditCampo(ctx) {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const pending = state.pendingNlpMovimientos.get(userId);
    if (!pending) return ctx.editMessageText('⚠️ El movimiento expiró. Mandalo de nuevo.');
    pending.editingCampo = campo;
    state.pendingNlpMovimientos.set(userId, pending);
    await ctx.reply(prompt);
  };
}

async function handleNlpEditReescribir(ctx) {
  await ctx.answerCbQuery();
  state.pendingNlpMovimientos.delete(ctx.from.id);
  return ctx.editMessageText('🔄 Movimiento descartado. Escribí el movimiento de nuevo con todos los detalles.');
}

async function handleNlpKeepOld(ctx) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingNlpMovimientos.get(userId);
  if (!pending) return ctx.editMessageText('⚠️ El movimiento expiró. Mandalo de nuevo.');
  pending.editingCampo = null;
  state.pendingNlpMovimientos.set(userId, pending);
  return ctx.editMessageText(crearMensajeConfirmacion(pending.entities), {
    parse_mode: 'Markdown',
    ...confirmationButtons(pending.entities),
  });
}

async function handleNlpDiscardOld(ctx) {
  await ctx.answerCbQuery();
  state.pendingNlpMovimientos.delete(ctx.from.id);
  return ctx.editMessageText('✅ Movimiento descartado. Mandá el nuevo mensaje de nuevo para procesarlo.');
}

const handleNlpEditMonto    = makeEditCampoHandler('monto',         '💰 Ingresá el nuevo monto (ej: 15000):');
const handleNlpEditPaciente = makeEditCampoHandler('pacienteNombre','👤 Ingresá el nombre del paciente:');
const handleNlpEditMetodo   = makeEditCampoHandler('metodo_pago',   '💳 Ingresá el método: efectivo / transferencia / tarjeta');
const handleNlpEditTipo     = makeEditCampoHandler('tipo',          '📊 Ingresá el tipo: ingreso / gasto');
const handleNlpEditEstado   = makeEditCampoHandler('estado',        '📋 Ingresá el estado: cobrado / pendiente');

// ── Register bot actions ──────────────────────────────────────────────────────

bot.action('nlp_save',           handleNlpSave);
bot.action('nlp_toggle_ambito',  handleNlpToggleAmbito);
bot.action('nlp_quitar_viaje',   handleNlpQuitarViaje);
bot.action('nlp_cancel',         handleNlpCancel);
bot.action('nlp_edit',           handleNlpEdit);
bot.action('nlp_edit_monto',     handleNlpEditMonto);
bot.action('nlp_edit_paciente',  handleNlpEditPaciente);
bot.action('nlp_edit_metodo',    handleNlpEditMetodo);
bot.action('nlp_edit_tipo',      handleNlpEditTipo);
bot.action('nlp_edit_estado',    handleNlpEditEstado);
bot.action('nlp_edit_reescribir',handleNlpEditReescribir);
bot.action('nlp_keep_old',       handleNlpKeepOld);
bot.action('nlp_discard_old',    handleNlpDiscardOld);

module.exports = {
  crearMensajeConfirmacion,
  esAmbitoPersonal,
  handleNlpToggleAmbito,
  handleNlpQuitarViaje,
  mostrarConfirmacion,
  actualizarCampoNlp,
  discardButtons,
  confirmationButtons,
  handleNlpSave,
  handleNlpCancel,
  handleNlpEdit,
  handleNlpEditMonto,
  handleNlpEditPaciente,
  handleNlpEditMetodo,
  handleNlpEditTipo,
  handleNlpEditEstado,
  handleNlpEditReescribir,
  handleNlpKeepOld,
  handleNlpDiscardOld,
};
