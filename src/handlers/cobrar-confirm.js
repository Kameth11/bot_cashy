const { bot } = require('../lib/telegraf');
const { Markup } = require('telegraf');
const state = require('../state');
const cmd = require('../services/command.service');
const { getRowDescripcion, getRowMonto, getRowMoneda, getRowFecha } = require('../utils/sheet-row');
const { formatMonto, escapeMarkdown } = require('../utils/formatter');

async function mostrarCobrar(ctx, resultado) {
  const userId = ctx.from.id;

  if (resultado.tipo === 'empty') {
    return ctx.reply('✅ No hay movimientos pendientes.');
  }

  if (resultado.tipo === 'single') {
    const { fila, montoCobrado } = resultado;
    const desc = escapeMarkdown(getRowDescripcion(fila, ''));
    const monto = formatMonto(getRowMonto(fila, 0), getRowMoneda(fila, 'Pesos'));
    const fecha = getRowFecha(fila) || '';

    state.pendingCobros.set(userId, { fila, montoCobrado });

    const msg =
      `⏳ *¿Cobramos este pendiente?*\n\n` +
      `📝 ${desc}\n` +
      `💰 ${monto}` +
      (fecha ? `\n📅 ${fecha}` : '');

    return ctx.reply(msg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Sí, cobrar', 'cobrar_confirm_si'),
          Markup.button.callback('❌ Cancelar', 'cobrar_cancel'),
        ]
      ])
    });
  }

  // picker: 0 o múltiples matches → mostrar todos los pendientes
  const { filas, montoCobrado } = resultado;
  state.pendingCobros.set(userId, { filas, montoCobrado, tipo: 'picker' });

  const botones = filas.slice(0, 8).map((f, i) => {
    const desc = getRowDescripcion(f, '');
    const label = `${desc.length > 22 ? desc.substring(0, 22) + '…' : desc} · ${formatMonto(getRowMonto(f, 0), getRowMoneda(f, 'Pesos'))}`;
    return [Markup.button.callback(label, `cobrar_pick_${i}`)];
  });
  botones.push([Markup.button.callback('❌ Cancelar', 'cobrar_cancel')]);

  return ctx.reply('⏳ *¿Cuál pendiente querés cobrar?*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(botones)
  });
}

// ── Confirmar cobro (flujo single) ────────────────────────────────────────────
bot.action('cobrar_confirm_si', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingCobros.get(userId);

  if (!pending || !pending.fila) {
    return ctx.editMessageText('⚠️ Sesión expirada. Mandá el mensaje de nuevo.');
  }
  state.pendingCobros.delete(userId);

  try {
    const resultado = await cmd.ejecutarCobrarFila(userId, pending.fila, pending.montoCobrado);
    return ctx.editMessageText(resultado, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Error cobrar_confirm_si:', err.message);
    return ctx.editMessageText('❌ Error al cobrar. Intentá de nuevo.');
  }
});

// ── Seleccionar del picker ────────────────────────────────────────────────────
bot.action(/^cobrar_pick_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const index = parseInt(ctx.match[1]);
  const pending = state.pendingCobros.get(userId);

  if (!pending || !pending.filas) {
    return ctx.editMessageText('⚠️ Sesión expirada. Mandá el mensaje de nuevo.');
  }

  const fila = pending.filas[index];
  if (!fila) return ctx.editMessageText('❌ Elemento no encontrado.');

  state.pendingCobros.delete(userId);

  try {
    const resultado = await cmd.ejecutarCobrarFila(userId, fila, pending.montoCobrado);
    return ctx.editMessageText(resultado, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Error cobrar_pick:', err.message);
    return ctx.editMessageText('❌ Error al cobrar. Intentá de nuevo.');
  }
});

// ── Cancelar ──────────────────────────────────────────────────────────────────
bot.action('cobrar_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  state.pendingCobros.delete(userId);
  return ctx.editMessageText('❌ Cancelado.');
});

module.exports = { mostrarCobrar };
