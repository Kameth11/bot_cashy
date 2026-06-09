/**
 * /nlptest <frase>
 * Muestra el resultado del NLP sin guardar nada.
 * Solo disponible para el admin (AUTHORIZED_USER_ID).
 */

const { bot } = require('../../lib/telegraf');
const { esAdminOriginal } = require('../../auth');
const quickNlp = require('../../services/quick_nlp.service');
const geminiService = require('../../services/gemini.service');

function formatEntities(entities = {}) {
  const lines = [];
  const order = [
    'tipo', 'descripcion', 'monto', 'moneda', 'metodo_pago', 'estado', 'categoria',
    'pacienteNombre', 'pagadorNombre', 'profesionalNombre', 'tratamientoNombre',
    'proveedorNombre', 'montoCobrado', 'monedaCobrada', 'montoDeuda', 'monedaDeuda',
    'montoTotal', 'nombre',
  ];

  for (const key of order) {
    if (entities[key] !== undefined && entities[key] !== null) {
      lines.push(`  *${key}*: \`${entities[key]}\``);
    }
  }

  // Campos extra no en la lista
  for (const [key, val] of Object.entries(entities)) {
    if (!order.includes(key) && val !== undefined && val !== null) {
      lines.push(`  *${key}*: \`${val}\``);
    }
  }

  return lines.length ? lines.join('\n') : '  _(vacío)_';
}

bot.command('nlptest', async (ctx) => {
  const userId = ctx.from.id;

  if (!esAdminOriginal(userId)) {
    return ctx.reply('⛔ Solo disponible para el administrador.');
  }

  const frase = ctx.message.text.replace(/^\/nlptest(@\w+)?\s*/i, '').trim();

  if (!frase) {
    return ctx.reply(
      '🧪 *Uso:* `/nlptest <frase>`\n\n' +
      'Ejemplos:\n' +
      '`/nlptest pagaron 300 euros y faltan 200 restantes`\n' +
      '`/nlptest cobré 15000 de Juan en efectivo`\n' +
      '`/nlptest gasto alquiler 80k transferencia`',
      { parse_mode: 'Markdown' }
    );
  }

  await ctx.reply('🔍 Analizando...').catch(() => {});

  // 1. Quick NLP
  const quickResult = quickNlp.quickParse(frase);

  let msg = `🧪 *NLP Test*\n\n📝 Frase: \`${frase}\`\n\n`;

  if (quickResult) {
    msg += `⚡ *Quick NLP* → \`${quickResult.intent}\`\n${formatEntities(quickResult.entities)}\n\n`;
    msg += `_Gemini no fue consultado (quick NLP resolvió)_`;
  } else {
    msg += `⚡ *Quick NLP* → ❌ no matcheó\n\n`;

    // 2. Gemini fallback
    try {
      msg += `🤖 *Gemini* → consultando...\n`;
      await ctx.reply(msg, { parse_mode: 'Markdown' }).catch(() => {});
      msg = '';

      const geminiResult = await geminiService.parseMessage(userId, frase);
      if (geminiResult) {
        msg = `🤖 *Gemini* → \`${geminiResult.intent}\`\n${formatEntities(geminiResult.entities)}`;
      } else {
        msg = `🤖 *Gemini* → ❌ sin resultado (API no disponible o timeout)`;
      }
    } catch (err) {
      msg = `🤖 *Gemini* → ❌ error: \`${err.message}\``;
    }
  }

  if (msg) {
    await ctx.reply(msg, { parse_mode: 'Markdown' }).catch(() => {
      ctx.reply(msg.replace(/[`*_[\]]/g, '')).catch(() => {});
    });
  }
});

module.exports = {};
