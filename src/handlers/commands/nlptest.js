/**
 * /nlptest <frase>
 * Muestra lado a lado qué devuelven las reglas (quick NLP) y Gemini para la
 * misma frase, y en qué difieren, sin guardar nada. Gemini se consulta SIEMPRE
 * (en producción solo se consulta si las reglas no resuelven), así se ve qué
 * pasaría con la IA en los casos donde las reglas aciertan o se equivocan.
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

// Compara intent y entidades de dos resultados. Un valor ausente y null cuentan
// igual; los números y textos se comparan normalizados.
function compararNlp(a, b) {
  const diffs = [];
  if (a.intent !== b.intent) diffs.push(`intent (${a.intent} vs ${b.intent})`);

  const ea = a.entities || {};
  const eb = b.entities || {};
  const norm = (v) => (v === undefined || v === null ? '' : String(v).trim().toLowerCase());
  for (const key of new Set([...Object.keys(ea), ...Object.keys(eb)])) {
    if (norm(ea[key]) !== norm(eb[key])) {
      diffs.push(`${key} (${norm(ea[key]) || '—'} vs ${norm(eb[key]) || '—'})`);
    }
  }
  return diffs;
}

async function consultarGemini(userId, frase) {
  if (!geminiService.canAttemptRemoteNlp()) {
    return { error: 'no disponible (sin GEMINI_API_KEY o en cooldown por rate limit)' };
  }
  try {
    const result = await geminiService.parseMessage(userId, frase);
    return result ? { result } : { error: 'sin resultado (API caída, timeout o respuesta inválida)' };
  } catch (err) {
    return { error: err.message };
  }
}

// Qué ámbito y categoría resolvería el bot para esta frase CON TUS preferencias
// aprendidas y TUS casas (es lo que decide marcarAmbito al cargar un movimiento).
async function diagnosticoAmbito(userId, frase) {
  try {
    const { resolverAmbito, inferirCategoriaPersonal } = require('../../services/personal-nlp.service');
    const personalService = require('../../services/personal.service');
    const casaService = require('../../services/casa.service');
    const preferencias = await personalService.leerPreferencias(userId);
    const casas = casaService.listarMisCasas(userId);
    const r = resolverAmbito(frase, { preferencias, casas });
    const destino = r.ambito === 'casa' ? `casa (${r.casaNombre})` : r.ambito;
    const categoria = r.ambito === 'consultorio' ? null : inferirCategoriaPersonal('gasto', frase);
    return `🏷️ *Ámbito:* \`${destino}\` (\`${r.razon}\`)${r.ambiguo ? ' — ambiguo, pide confirmar' : ''}` +
      (r.termino ? `\n  término: \`${r.termino}\`` : '') +
      (categoria ? `\n  categoría: \`${categoria}\`` : '') +
      `\n  casas: ${casas.length}`;
  } catch (err) {
    return `🏷️ *Ámbito:* ❌ no se pudo calcular (${err.message})`;
  }
}

function armarMensaje(frase, quickResult, gemini, ambito) {
  let msg = `🧪 *NLP Test*\n\n📝 Frase: \`${frase}\`\n\n`;

  msg += quickResult
    ? `⚡ *Reglas* → \`${quickResult.intent}\`\n${formatEntities(quickResult.entities)}\n\n`
    : `⚡ *Reglas* → ❌ no matchearon (en producción iría a Gemini)\n\n`;

  msg += gemini.result
    ? `🤖 *Gemini* → \`${gemini.result.intent}\`\n${formatEntities(gemini.result.entities)}\n\n`
    : `🤖 *Gemini* → ❌ ${gemini.error}\n\n`;

  if (quickResult && gemini.result) {
    const diffs = compararNlp(quickResult, gemini.result);
    msg += diffs.length
      ? `⚠️ *Difieren:* ${diffs.join(', ')}`
      : `✅ *Coinciden*`;
  } else if (quickResult) {
    msg += `_Sin Gemini no se puede comparar._`;
  } else if (gemini.result) {
    msg += `_Solo respondió Gemini._`;
  }
  if (ambito) msg += `\n\n${ambito}`;
  return msg;
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
      'Compara lado a lado las reglas y Gemini.\n\n' +
      'Ejemplos:\n' +
      '`/nlptest pagaron 300 euros y faltan 200 restantes`\n' +
      '`/nlptest cobré 15000 de Juan en efectivo`\n' +
      '`/nlptest gasto alquiler 80k transferencia`',
      { parse_mode: 'Markdown' }
    );
  }

  await ctx.reply('🔍 Analizando...').catch(() => {});

  const quickResult = quickNlp.quickParse(frase);
  const gemini = await consultarGemini(userId, frase);
  const msg = armarMensaje(frase, quickResult, gemini, await diagnosticoAmbito(userId, frase));

  await ctx.reply(msg, { parse_mode: 'Markdown' }).catch(() => {
    ctx.reply(msg.replace(/[`*_[\]]/g, '')).catch(() => {});
  });
});

module.exports = { compararNlp, armarMensaje, diagnosticoAmbito };
