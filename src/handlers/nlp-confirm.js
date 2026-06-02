const { Markup } = require('telegraf');
const { bot } = require('../lib/telegraf');
const state = require('../state');
const cmd = require('../services/command.service');
const { escapeMarkdown, formatMonto } = require('../utils/formatter');

// ── Formatting ───────────────────────────────────────────────────────────────

function formatMontoConMoneda(monto, moneda) {
  if (!monto) return '—';
  if (moneda === 'Euros') return `€${Math.abs(monto).toLocaleString('es-AR')}`;
  return formatMonto(monto, moneda);
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

  const nombreLabel = esEgreso ? 'Proveedor' : 'Paciente';
  const nombreValor = esEgreso ? es.proveedorNombre : es.pacienteNombre;

  return (
    `📋 *Entendí esto:*\n\n` +
    `• Tipo: ${tipoTexto}\n` +
    `• Monto: ${montoTexto}${es.monto ? monedaLabel : ''}\n` +
    `• ${nombreLabel}: ${v(nombreValor)}\n` +
    `• Método: ${v(metodo)}\n` +
    `• Estado: ${estadoTexto}\n` +
    `• Tratamiento: ${v(es.tratamientoNombre)}\n` +
    `\n_¿Es correcto?_`
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

function confirmationButtons() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Guardar', 'nlp_save'),
      Markup.button.callback('❌ Cancelar', 'nlp_cancel'),
    ],
    [
      Markup.button.callback('✏️ Editar un campo', 'nlp_edit'),
    ],
  ]);
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
    ...confirmationButtons(),
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
    ...confirmationButtons(),
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

  try {
    const resultado = await cmd.registrarMovimientoDesdeNLP(userId, pending.entities);
    if (resultado.necesitaInfo) {
      await ctx.editMessageText('⏳ Completando datos...');
      return ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' });
    }
    if (resultado.success) {
      return ctx.editMessageText(resultado.mensaje, { parse_mode: 'Markdown' });
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
    ...confirmationButtons(),
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
