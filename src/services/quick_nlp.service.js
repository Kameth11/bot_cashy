function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsNormalizedTerm(text, term) {
  const normalizedText = normalizar(text);
  const normalizedTerm = normalizar(term);
  if (!normalizedText || !normalizedTerm) return false;

  const regex = new RegExp(`(?:^|\\s)${escapeRegex(normalizedTerm)}(?:$|\\s)`, 'i');
  return regex.test(normalizedText);
}

function normalizarNumero(raw) {
  if (!raw) return null;

  const cleaned = String(raw).trim().toLowerCase().replace(/\s+/g, '');
  let multiplier = 1;
  let base = cleaned;

  if (/(lucas?|luca|mil|k)$/.test(cleaned)) {
    multiplier = 1000;
    base = cleaned.replace(/(lucas?|luca|mil|k)$/g, '');
  } else if (/(palos?|palo|millon(?:es)?)$/.test(cleaned)) {
    multiplier = 1000000;
    base = cleaned.replace(/(palos?|palo|millon(?:es)?)$/g, '');
  }

  if (!base) base = '1';

  const normalized = base.replace(/\./g, '').replace(',', '.');
  const value = parseFloat(normalized);
  if (isNaN(value) || value <= 0) return null;

  return Math.round(value * multiplier * 100) / 100;
}

function extraerMonto(rawText) {
  const patterns = [
    /u\$s?\s*(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/i,
    /usd\s*(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/i,
    /u\$s?\s*(\d+(?:[.,]\d{1,2})?)/i,
    /usd\s*(\d+(?:[.,]\d{1,2})?)/i,
    /\$\s*(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/i,
    /(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)\b/i,
    /(\d+(?:[.,]\d{1,2})?)\s*(?:pesos|mangos|guita|plata|dolares?|usd)/i,
  ];
  for (const p of patterns) {
    const m = rawText.match(p);
    if (m) {
      const valueToken = `${m[1]}${m[2] ? ` ${m[2]}` : ''}`;
      const val = normalizarNumero(valueToken);
      if (!isNaN(val) && val > 0) {
        const isUsd = /u\$s?|usd|dolar/i.test(rawText.substring(Math.max(0, m.index - 5), m.index + m[0].length + 5));
        return { monto: val, moneda: isUsd ? 'Dolares' : 'Pesos' };
      }
    }
  }
  const simple = rawText.match(/\b(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?\b/i);
  if (simple) {
    const valueToken = `${simple[1]}${simple[2] ? ` ${simple[2]}` : ''}`;
    const val = normalizarNumero(valueToken);
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

function limpiarTextoPendienteBase(text) {
  return String(text || '')
    .replace(/\b(?:por\s+cobrar|sin\s+cobrar)\b/gi, ' ')
    .replace(/u\$s?\s*\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/gi, ' ')
    .replace(/usd\s*\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/gi, ' ')
    .replace(/\$\s*\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/gi, ' ')
    .replace(/\b\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?\b/gi, ' ')
    .replace(/\b(?:pesos|mangos|guita|plata|dolares?|usd)\b/gi, ' ')
    .replace(/\b(?:efectivo|contado|cash|transferencia|transfer|transf|tf|tbu|mercadopago|mercado\s*pago|mp|tarjeta|debito|credito|visa|master|mc)\b/gi, ' ')
    .replace(/[.,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function capitalizarFrase(text) {
  if (!text || text.length < 2) return null;
  return text.split(' ').filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function extraerDescripcionPendiente(rawText) {
  const original = String(rawText || '').trim();
  const cleaned = limpiarTextoPendienteBase(original);

  if (!cleaned) return null;

  if (/^(?:\/)?pendiente\b/i.test(cleaned)) {
    const descripcionDirecta = cleaned
      .replace(/^(?:\/)?pendiente\s+/i, '')
      .trim();
    return capitalizarFrase(descripcionDirecta);
  }

  const conectorMatch = cleaned.match(/\b(?:de|del)\s+(.+)$/i);
  if (conectorMatch && conectorMatch[1]) {
    return capitalizarFrase(conectorMatch[1].trim());
  }

  const sinPrefijo = cleaned
    .replace(/^(?:me\s+deben|me\s+debe|debe|deben|quedo\s+pendiente|quedo\s+debiendo|quedo\s+sin\s+cobrar|sin\s+cobrar)\s*/i, '')
    .trim();

  if (!sinPrefijo) return null;
  if (/^(?:en|por|con)\b/i.test(sinPrefijo)) return null;
  return capitalizarFrase(sinPrefijo);
}

function extraerDescripcionPendienteNombrePrimero(rawText) {
  const match = String(rawText || '').trim().match(/^(.+?)\s+me\s+debe(?:n)?\s+/i);
  if (!match || !match[1]) return null;

  const descripcion = match[1]
    .replace(/^(?:a\s+)?/i, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();

  return capitalizarFrase(descripcion);
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
    if (/^\d+(?:[.,]\d{1,2})?(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)$/.test(wNorm)) continue;
    if (/^[\$u\$s]*\d+(?:[.,]\d{1,2})?(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?$/.test(wordsOrig[i].replace(/[Uu]\$[Ss]?/, ''))) continue;
    if (/^(pesos|mangos|guita|plata|dola?r(?:es)?|usd|\$|u\$s?|lucas?|luca|mil|k|palos?|palo|millon(?:es)?)$/.test(wNorm)) continue;
    if (allTipoWords.some(tw => wNorm === normalizar(tw))) continue;
    if (/^(cobre|cobro|pago|gaste|gasto|pague|ingrese|ingreso|ingresaron|cargue|cargo|facture|facturo|recibi|compre|sali|egrese|egreso|consulta|servicio|entro|entraron|entrada|salio|salieron|fueron|vendi|depositaron|transferieron)$/i.test(wNorm)) continue;
    if (metodo === 'efectivo' && /^(efectivo|contado|cash)$/.test(wNorm)) continue;
    if (metodo === 'transferencia' && /^(transferencia|transfer|transf|tf|tbu|mercadopago|mp)$/.test(wNorm)) continue;
    if (metodo === 'tarjeta' && /^(tarjeta|debito|credito|visa|master|mc)$/.test(wNorm)) continue;
    if (/^(de|del|en|la|el|lo|los|las|con|por|se|me|te|ya|un|una|pesos|mangos|guita|plata|dolares?|usd)$/.test(wNorm)) continue;

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
  { intent: 'ver_sheet', words: ['sheet', 'sheets'], phrases: ['mi sheet', 'abrir sheet', 'ver sheet', 'mi google sheet', 'abrir google sheet'] },
  { intent: 'ver_ayuda', words: ['ayuda', 'help'], phrases: ['como funciona', 'que puedo hacer', 'que haces', 'comandos'] },
  { intent: 'listar_movimientos', words: ['listar', 'listado'], phrases: ['ver todo', 'ver movimientos', 'todos los movimientos', 'ver todos', 'lista de movimientos', 'lista completa', 'ver lista'] },
];

const INGRESO_WORDS = ['cobre', 'cobro', 'me pagaron', 'me pago', 'pagaron', 'se cobro', 'se cobraron', 'se pago', 'se pagaron', 'pago', 'ingrese', 'ingreso', 'ingresaron', 'cargue', 'cargo', 'facture', 'facturo', 'recibi', 'consulta', 'servicio', 'atendi', 'entro', 'entraron', 'me entro', 'me entraron', 'cobraron', 'cobramos', 'depositaron', 'transferieron', 'vendi', 'vendio', 'cobraste', 'cobro', 'pagamos'];

const EGRESO_WORDS = ['gaste', 'gasto', 'se gasto', 'pague', 'costo de', 'compre', 'compra', 'sali', 'salida', 'egrese', 'egreso', 'salio', 'salieron', 'se fue', 'se me fue', 'costo', 'erogo'];

function matchKeywordIntent(text) {
  for (const { intent, words, phrases } of KEYWORD_INTENTS) {
    for (const phrase of phrases) {
      if (containsNormalizedTerm(text, phrase)) return intent;
    }
    for (const word of words) {
      if (containsNormalizedTerm(text, word)) return intent;
    }
  }
  return null;
}

const ENTITY_INTENTS = [
  { intent: 'cobrar_movimiento', patterns: [/^(?:cobrar|cobro|ya me pago|ya me pagaron|ya cobro|marcar cobrado|marcar como cobrado|ya cobre|ya pago|cobrale|cobra|me pago|me pag[oó]|ya entro lo de|entro lo de|entr[oó] lo de|me transfirio|me transfiri[oó]|me deposito|me deposit[oó])\s+(.+)$/i, /^(.+?)\s+(?:me pago|me pag[oó]|me transfirio|me transfiri[oó]|me deposito|me deposit[oó])$/i], entityKey: 'nombre' },
  { intent: 'editar_movimiento', patterns: [/^(?:editar|modificar|cambiar|corregir|edita|cambio)\s+(.+)$/i], entityKey: 'nombre' },
  { intent: 'eliminar_movimiento', patterns: [/^(?:eliminar|borrar|borra|quitar|elimina|borrame|borro|elimino|borralo|borrarlo|eliminarlo|eliminame)\s+(.+)$/i], entityKey: 'nombre' },
];

function matchRegistrarPendiente(rawText, text) {
  if (!/^(?:\/?pendiente\b|me\s+deben\b|me\s+debe\b|debe\b|deben\b|quedo\s+pendiente\b|quedo\s+debiendo\b|sin\s+cobrar\b|.+?\s+me\s+debe(?:n)?\b)/i.test(text)) {
    return null;
  }

  const montoInfo = extraerMonto(rawText);
  const metodo_pago = extraerMetodo(text);
  const descripcion = extraerDescripcionPendienteNombrePrimero(rawText) || extraerDescripcionPendiente(rawText);

  return {
    intent: 'registrar_movimiento',
    entities: {
      tipo: 'ingreso',
      descripcion,
      monto: montoInfo ? montoInfo.monto : null,
      moneda: montoInfo ? montoInfo.moneda : 'Pesos',
      metodo_pago,
      estado: 'Pendiente'
    }
  };
}

function matchRegistrarMovimiento(rawText, text) {
  const montoInfo = extraerMonto(rawText);
  const monto = montoInfo ? montoInfo.monto : null;
  const moneda = montoInfo ? montoInfo.moneda : 'Pesos';

  let tipo = null;
  for (const word of INGRESO_WORDS) {
    if (containsNormalizedTerm(text, word)) { tipo = 'ingreso'; break; }
  }
  if (!tipo) {
    for (const word of EGRESO_WORDS) {
      if (containsNormalizedTerm(text, word)) { tipo = 'gasto'; break; }
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

  const pendienteResult = matchRegistrarPendiente(rawText, text);
  if (pendienteResult) return pendienteResult;

  const montoInfo = extraerMonto(rawText);
  if (!montoInfo) {
    const entityFirst = matchEntityIntent(text);
    if (entityFirst) return entityFirst;

    const keywordFirst = matchKeywordIntent(text);
    if (keywordFirst) return { intent: keywordFirst, entities: {} };
  }

  const regResult = matchRegistrarMovimiento(rawText, text);
  if (regResult) return regResult;

  const entityResult = matchEntityIntent(text);
  if (entityResult) return entityResult;

  const keywordResult = matchKeywordIntent(text);
  if (keywordResult) return { intent: keywordResult, entities: {} };

  return null;
}

module.exports = { quickParse, INGRESO_WORDS, EGRESO_WORDS, KEYWORD_INTENTS, ENTITY_INTENTS };
