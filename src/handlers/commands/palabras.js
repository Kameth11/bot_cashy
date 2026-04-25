const { bot } = require('../../lib/telegraf');
const { INGRESO_WORDS, EGRESO_WORDS } = require('../../services/quick_nlp.service');

bot.command('palabras', (ctx) => {
  const chunkSize = 25;
  const chunks = [];
  
  const ingresos = INGRESO_WORDS;
  const egresos = EGRESO_WORDS;

  for (let i = 0; i < ingresos.length; i += chunkSize) {
    const slice = ingresos.slice(i, i + chunkSize);
    chunks.push(
      '🟢 *Ingresos (' + (i / chunkSize + 1) + '):*\n' +
      slice.map(w => '• ' + w).join('\n')
    );
  }

  for (let i = 0; i < egresos.length; i += chunkSize) {
    const slice = egresos.slice(i, i + chunkSize);
    chunks.push(
      '🔴 *Egresos (' + (i / chunkSize + 1) + '):*\n' +
      slice.map(w => '• ' + w).join('\n')
    );
  }

  chunks.push(
    '💳 *Metodos de pago:*\n' +
    '• efectivo, contado, cash\n' +
    '• transferencia, transfer, transf, tf, tbu, mp, mercadopago\n' +
    '• tarjeta, debito, credito, visa, master, mc\n\n' +
    '💵 *Monedas:*\n' +
    '• Pesos: $ o "pesos"\n' +
    '• Dolares: U$, U$S, USD, "dolares"'
  );

  for (const chunk of chunks) {
    ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(() => {
      ctx.reply(chunk);
    });
  }
});

module.exports = {};