const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');

const PENDIENTE_REGEX = /^(.+?)\s+(?:\$|U\$|USD)?\s*(-?\d+(?:\.\d{1,2})?)\s*((?:efectivo|transferencia|tarjeta))?$/i;

bot.command('pendiente', async (ctx) => {
  try {
    const input = ctx.message.text.replace('/pendiente', '').trim();

    if (!input) {
      return ctx.reply(
        '🧾 *Registrar pendiente*\n\n' +
        'Uso: `/pendiente [descripcion] $[monto]`\n\n' +
        'Ejemplos:\n' +
        '`/pendiente Juan Perez $15000`\n' +
        '`/pendiente Endodoncia U$50`',
        { parse_mode: 'Markdown' }
      );
    }

    const match = input.match(PENDIENTE_REGEX);
    if (!match) {
      return ctx.reply('⚠️ Formato inválido. Ejemplo: `/pendiente Juan Perez $15000`', { parse_mode: 'Markdown' });
    }

    const descripcion = match[1].trim();
    const monto = parseFloat(match[2]);
    const moneda = /u\$|usd/i.test(input) ? 'Dólares' : 'Pesos';
    const metodo = match[3] ? match[3].toLowerCase() : null;

    if (Number.isNaN(monto) || monto === 0) {
      return ctx.reply('❌ Error: el monto no puede ser 0.');
    }

    const resultado = await cmd.guardarMovimiento(ctx.from.id, {
      descripcion,
      monto: Math.abs(monto),
      tipo: 'Ingreso',
      moneda,
      metodo_pago: metodo,
      estado: 'Pendiente',
      categoria: 'cobro_pendiente',
    }, {
      estado: 'Pendiente',
    });

    return ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /pendiente:', error.message);
    return ctx.reply('❌ Error al registrar pendiente.');
  }
});

module.exports = {};
