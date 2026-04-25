function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extraerMonto(rawText) {
  const patterns = [
    /u\$s?\s*(\d+(?:[.,]\d{1,2})?)/i,
    /usd\s*(\d+(?:[.,]\d{1,2})?)/i,
    /\$\s*(\d+(?:[.,]\d{1,2})?)/,
    /(\d+(?:[.,]\d{1,2})?)\s*(?:pesos|dolares?|usd)/i,
  ];
  for (const p of patterns) {
    const m = rawText.match(p);
    if (m) {
      const val = parseFloat(m[1].replace(',', '.'));
      if (!isNaN(val) && val > 0) {
        const isUsd = /u\$s?|usd|dolar/i.test(rawText.substring(Math.max(0, m.index - 5), m.index + m[0].length + 5));
        return { monto: val, moneda: isUsd ? 'Dolares' : 'Pesos' };
      }
    }
  }
  const simple = rawText.match(/\b(\d+(?:[.,]\d{1,2})?)\b/);
  if (simple) {
    const val = parseFloat(simple[1].replace(',', '.'));
    if (!isNaN(val) && val > 0) {
      const isUsd = /u\$s?|usd|dolar/i.test(rawText);
      return { monto: val, moneda: isUsd ? 'Dolares' : 'Pesos' };
    }
  }
  return null;
}

function extraerMetodo(text) {
  if (/\b(?:efectivo|contado|cash)\b/i.test(text)) return 'efectivo';
  if (/\b(?:transferencia|transfer|transf|tf|tbu)\b/i.test(text)) return 'transferencia';
  if (/\b(?:tarjeta|debito|credito|debito|visa|master|mc)\b/i.test(text)) return 'tarjeta';
  if (/\b(?:mercadopago|mp|mercado\s*pago)\b/i.test(text)) return 'transferencia';
  return null;
}

function extraerDescripcion(rawText, tipo, metodo) {
  const allTipoWords = [...INGRESO_WORDS, ...EGRESO_WORDS];
  const normText = normalizar(rawText);
  const wordsNorm = normText.split(' ');
  const wordsOrig = rawText.split(' ');

  const cleanWords = [];
  for (let i = 0; i < wordsOrig.length; i++) {
    const wNorm = normalizar(wordsOrig[i]);
    if (!wNorm) continue;

    if (/^\d+(?:[.,]\d{1,2})?$/.test(wNorm)) continue;
    if (/^[\$u\$s]*\d+(?:[.,]\d{1,2})?$/.test(wordsOrig[i].replace(/[Uu]\$[Ss]?/, ''))) continue;
    if (/^(pesos|dola?r(?:es)?|usd|\$|u\$s?)$/.test(wNorm)) continue;
    if (allTipoWords.some(tw => wNorm === normalizar(tw))) continue;
    if (/^(cobre|cobro|cobro|pago|gaste|gasto|pague|ingrese|ingreso|ingresaron|cargue|cargo|facture|facturo|recibi|compre|sali|egrese|egreso|consulta|servicio)$/i.test(wNorm)) continue;
    if (metodo === 'efectivo' && /^(efectivo|contado|cash)$/.test(wNorm)) continue;
    if (metodo === 'transferencia' && /^(transferencia|transfer|transf|tf|tbu|mercadopago|mp)$/.test(wNorm)) continue;
    if (metodo === 'tarjeta' && /^(tarjeta|debito|credito|visa|master|mc)$/.test(wNorm)) continue;
    if (/^(de|en|la|el|con|por|se|me|pesos|dolares?|usd)$/.test(wNorm)) continue;

    cleanWords.push(wordsOrig[i]);
  }

  const result = cleanWords.join(' ').replace(/[.,;:!?]/g, '').trim();
  if (result.length < 2) return null;
  const words = result.split(' ').filter(w => w.length > 1);
  return words.length > 0 ? words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : null;
}

const KEYWORD_INTENTS = [
  { intent: 'ver_balance', words: ['balance', 'resumen de caja', 'estado de caja', 'caja'], phrases: ['cuanto tengo', 'como estoy', 'como va la caja', 'que tengo', 'como va', 'como ando'] },
  { intent: 'ver_hoy', words: [], phrases: ['que hubo hoy', 'movimientos de hoy', 'que cobre hoy', 'cobros de hoy', 'como le fue hoy', 'como estuvo hoy', 'como va hoy', 'que paso hoy', 'que hubo'] },
  { intent: 'ver_semana', words: [], phrases: ['como va la semana', 'movimientos de la semana', 'esta semana', 'resumen semanal', 'resumen de la semana', 'que cobre esta semana', 'como va la sem', 'la semana'] },
  { intent: 'ver_mes', words: [], phrases: ['como va el mes', 'movimientos del mes', 'este mes', 'resumen mensual', 'resumen del mes', 'que cobre este mes', 'el mes'] },
  { intent: 'ver_ingresos', words: ['ingresos', 'cobros'], phrases: ['que cobre', 'mis ingresos', 'lista de ingresos', 'ver ingresos', 'mostrar ingresos', 'los ingresos'] },
  { intent: 'ver_egresos', words: ['egresos'], phrases: ['mis gastos', 'lista de egresos', 'ver egresos', 'ver gastos', 'mostrar gastos', 'que gaste', 'los gastos', 'mis egresos'] },
  { intent: 'ver_pendientes', words: ['pendientes'], phrases: ['que me falta cobrar', 'sin cobrar', 'adeudados', 'sin pagar', 'por cobrar', 'ver pendientes', 'mostrar pendientes', 'quienes me deben', 'quienes no pagaron', 'me deben'] },
  { intent: 'ver_dolar', words: ['cotizacion', 'coti', 'dolar'], phrases: ['cuanto vale el dolar', 'dolar blue', 'precio dolar', 'valor dolar', 'cuanto esta el dolar', 'a cuanto esta el dolar', 'cuanto el dolar', 'cotizacion del dolar', 'valor del dolar', 'precio del dolar'] },
  { intent: 'actualizardolar', words: [], phrases: ['actualizar dolar', 'actualizar cotizacion', 'actualizar coti', 'nueva coti', 'actualiza dolar', 'update dolar', 'actualizar el dolar', 'actualizar la cotizacion'] },
  { intent: 'ver_ayuda', words: ['ayuda', 'help'], phrases: ['como funciona', 'que puedo hacer', 'que haces', 'comandos'] },
  { intent: 'listar_movimientos', words: ['listar', 'listado'], phrases: ['ver todo', 'ver movimientos', 'todos los movimientos', 'ver todos', 'lista de movimientos', 'lista completa', 'ver lista'] },
];

const INGRESO_WORDS = ['cobre', 'cobro', 'me pagaron', 'me pago', 'pagaron', 'se cobro', 'se cobraron', 'se pago', 'se pagaron', 'pago', 'ingrese', 'ingreso', 'ingresaron', 'cargue', 'cargo', 'facture', 'facturo', 'recibi', 'consulta', 'servicio', 'atendi', 'entro', 'cobraron', 'cobramos', 'depositaron', 'transferieron', 'vendi', 'vendio', 'cobraste', 'cobro', 'pagamos'];

const EGRESO_WORDS = ['gaste', 'gasto', 'se gasto', 'pague', 'costo de', 'compre', 'compra', 'sali', 'salida', 'egrese', 'egreso', 'salio', 'costo', 'erogo'];

function matchKeywordIntent(text) {
  for (const { intent, words, phrases } of KEYWORD_INTENTS) {
    for (const phrase of phrases) {
      if (text.includes(phrase)) return intent;
    }
    for (const word of words) {
      const regex = new RegExp(`(?:^|\\s)${word}(?:$|\\s)`, 'i');
      if (regex.test(text)) return intent;
    }
  }
  return null;
}

const ENTITY_INTENTS = [
  { intent: 'cobrar_movimiento', patterns: [/^(?:cobrar|cobro|ya me pago|ya me pagaron|ya cobro|marcar cobrado|marcar como cobrado|ya cobre|ya pago|cobrale|cobra)\s+(.+)$/i], entityKey: 'nombre' },
  { intent: 'editar_movimiento', patterns: [/^(?:editar|modificar|cambiar|corregir|edita|cambio)\s+(.+)$/i], entityKey: 'nombre' },
  { intent: 'eliminar_movimiento', patterns: [/^(?:eliminar|borrar|borra|quitar|elimina|borrame|borro|elimino|borralo|borrarlo|eliminarlo|eliminame)\s+(.+)$/i], entityKey: 'nombre' },
];

function matchRegistrarMovimiento(rawText, text) {
  const montoInfo = extraerMonto(rawText);
  if (!montoInfo) return null;

  const { monto, moneda } = montoInfo;

  let tipo = null;
  const textLower = text.toLowerCase();
  for (const word of INGRESO_WORDS) {
    if (textLower.includes(word)) { tipo = 'ingreso'; break; }
  }
  if (!tipo) {
    for (const word of EGRESO_WORDS) {
      if (textLower.includes(word)) { tipo = 'gasto'; break; }
    }
  }
  if (!tipo) return null;

  const metodo_pago = extraerMetodo(text);
  const descripcion = extraerDescripcion(rawText, tipo, metodo_pago);

  return {
    intent: 'registrar_movimiento',
    entities: { tipo, descripcion, monto, moneda, metodo_pago }
  };
}

function matchEntityIntent(text) {
  for (const { intent, patterns, entityKey } of ENTITY_INTENTS) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].trim().length > 0) {
        return { intent, entities: { [entityKey]: match[1].trim() } };
      }
    }
  }
  return null;
}

function quickParse(rawText) {
  const text = normalizar(rawText);
  if (!text || text.length < 2) return null;

  if (/^(?:si|no|s|n|yes|y|ok|dale|bueno|vale)$/i.test(text)) return null;

  const regResult = matchRegistrarMovimiento(rawText, text);
  if (regResult) return regResult;

  const entityResult = matchEntityIntent(text);
  if (entityResult) return entityResult;

  const keywordResult = matchKeywordIntent(text);
  if (keywordResult) return { intent: keywordResult, entities: {} };

  return null;
}

module.exports = { quickParse, INGRESO_WORDS, EGRESO_WORDS, KEYWORD_INTENTS, ENTITY_INTENTS };