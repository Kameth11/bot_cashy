const { bot } = require('../../lib/telegraf');
const db = require('../../services/db.service');
const state = require('../../state');
const { escapeMarkdown } = require('../../utils/formatter');
const { getRowDescripcion, getRowMonto, getRowMoneda, getRowFecha, getRowIdUnico } = require('../../utils/sheet-row');
const { buildDeleteListKeyboard } = require('../actions');

function rowToItem(fila) {
  return {
    fila,
    desc:   getRowDescripcion(fila, 'Sin descripción'),
    monto:  getRowMonto(fila, 0),
    moneda: getRowMoneda(fila, 'Pesos'),
    fecha:  getRowFecha(fila, ''),
    id:     getRowIdUnico(fila, ''),
  };
}

bot.command('eliminar', async (ctx) => {
  const userId = ctx.from.id;
  const query = ctx.message.text.replace(/^\/eliminar(@\w+)?/i, '').trim();

  try {
    const filas = await db.getRows(userId);

    if (filas.length === 0) {
      return ctx.reply('📭 No hay movimientos registrados.').catch(() => {});
    }

    let items;
    let searchQuery = null;

    if (query) {
      // Modo búsqueda: filtra por descripción o ID
      const q = query.toLowerCase();
      const matches = filas.filter(f => {
        const desc = getRowDescripcion(f, '').toLowerCase();
        const id   = getRowIdUnico(f, '').toLowerCase();
        return id === q || desc.includes(q);
      });

      if (matches.length === 0) {
        // Sin resultados: muestra los últimos como fallback
        const fallback = filas.slice(-8).reverse().map(rowToItem);
        state.pendingDeletes.set(userId, { type: 'list', items: fallback, step: 'select', query: null });
        const { titulo, keyboard } = buildDeleteListKeyboard(fallback, null);
        return ctx.reply(
          `❌ Sin resultados para *"${escapeMarkdown(query)}"*\n\n${titulo}`,
          { parse_mode: 'Markdown', ...keyboard }
        ).catch(() => {});
      }

      items = matches.slice(-8).reverse().map(rowToItem);
      searchQuery = query;
    } else {
      // Sin argumento: últimos 8
      items = filas.slice(-8).reverse().map(rowToItem);
    }

    state.pendingDeletes.set(userId, { type: 'list', items, step: 'select', query: searchQuery });

    const { titulo, keyboard } = buildDeleteListKeyboard(items, searchQuery);
    ctx.reply(titulo, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
  } catch (err) {
    console.error('Error /eliminar:', err.message);
    ctx.reply('❌ Error al cargar movimientos.').catch(() => {});
  }
});

module.exports = {};
