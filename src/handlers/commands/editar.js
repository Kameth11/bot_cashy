const { bot } = require('../../lib/telegraf');
const { getSheetCliente } = require('../../services/sheet.service');
const { formatMonto } = require('../../utils/formatter');
const state = require('../../state');
const { getRowDescripcion, getRowIdUnico, getRowMonto, getRowMoneda, getRowTipo, getRowFecha } = require('../../utils/sheet-row');

bot.command('editar', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1);

    if (args.length === 0) {
      return ctx.reply(
        `📝 *Editar movimiento*\n\n` +
        `Uso: /editar [ID o nombre]\n\n` +
        `Podrás modificar:\n` +
        `• Descripción\n` +
        `• Monto\n\n` +
        `Ejemplo: /editar consulta Juan`
      );
    }

    const texto = ctx.message.text.replace('/editar', '').trim().toLowerCase();
    console.log('DEBUG /editar - buscando:', texto);

    const sheet = await getSheetCliente(ctx.from.id);
    if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');
    const filas = await sheet.getRows();
    console.log('DEBUG /editar - filas encontradas:', filas.length);

    let filaActual = null;
    const coincidencias = [];

    filas.forEach((f) => {
      const desc = getRowDescripcion(f, '').toLowerCase();
      const id = getRowIdUnico(f, '').toLowerCase();

      if (id === texto || desc.includes(texto)) {
        coincidencias.push(f);
      }
    });

    console.log('DEBUG /editar - coincidencias:', coincidencias.length);

    if (coincidencias.length === 0) {
      return ctx.reply('❌ No se encontró ningún movimiento.');
    }

    if (coincidencias.length > 1) {
      let msg = `⚠️ *Varias coincidencias:*\n\n`;
      coincidencias.slice(0, 5).forEach((c, i) => {
        msg += `${i + 1}. ${getRowDescripcion(c, '')}\n`;
        msg += `   ${formatMonto(getRowMonto(c, 0), getRowMoneda(c, 'Pesos'))} - ${getRowFecha(c)}\n\n`;
      });
      msg += `\nEspecificá mejor: /editar [ID completo]`;
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    filaActual = coincidencias[0];

    const montoActual = getRowMonto(filaActual, 0);
    const moneda = getRowMoneda(filaActual, 'Pesos');
    const descripcionActual = getRowDescripcion(filaActual, '');
    const tipo = getRowTipo(filaActual, 'Ingreso');

    state.pendingEdits.set(ctx.from.id, {
      fila: filaActual,
      descripcionOriginal: descripcionActual,
      descripcion: descripcionActual,
      montoOriginal: montoActual,
      nuevoMonto: montoActual,
      moneda,
      tipo,
      step: 'descripcion'
    });

    ctx.reply(
      `📝 *Editar movimiento*\n\n` +
      `📝 Descripción actual: *${descripcionActual}*\n\n` +
      'Escribí la nueva descripción (o enviai "- -" para mantener la actual)',
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Error /editar:', error.message);
    ctx.reply('❌ Error al buscar movimiento.');
  }
});

module.exports = {};
