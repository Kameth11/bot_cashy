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
          return { monto: val, moneda: isUsd ? 'Dólares' : 'Pesos' };
        }
      }
  }
  const simple = rawText.match(/\b(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?\b/i);
  if (simple) {
    const valueToken = `${simple[1]}${simple[2] ? ` ${simple[2]}` : ''}`;
    const val = normalizarNumero(valueToken);
    if (!isNaN(val) && val > 0) {
      const isUsd = /u\$s?|usd|dolar/i.test(rawText);
      return { monto: val, moneda: isUsd ? 'Dólares' : 'Pesos' };
    }
  }
  return null;
}

function extraerMetodo(text) {
  if (/\b(?:efectivo|contado|cash)\b/i.test(text)) return 'efectivo';
  if (/\b(?:transferencia|transfer|transf|tf|tbu|cbu|alias|deposito|depositaron|transferi|transferiste|transferido)\b/i.test(text)) return 'transferencia';
  if (/\b(?:tarjeta|debito|credito|visa|master|mc|posnet)\b/i.test(text)) return 'tarjeta';
  if (/\b(?:mercadopago|mp|mercado\s*pago|qr)\b/i.test(text)) return 'transferencia';
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
    .replace(/\b(?:efectivo|contado|cash|transferencia|transfer|transf|tf|tbu|cbu|alias|deposito|mercadopago|mercado\s*pago|mp|qr|tarjeta|debito|credito|visa|master|mc|posnet)\b/gi, ' ')
    .replace(/[.,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function capitalizarFrase(text) {
  if (!text || text.length < 2) return null;
  return text.split(' ').filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

const TRATAMIENTO_KEYWORDS = [
  'implante',
  'ortodoncia',
  'endodoncia',
  'limpieza',
  'blanqueamiento',
  'extraccion',
  'extracción',
  'carilla',
  'corona',
  'protesis',
  'prótesis',
  'brackets',
  'perno',
  'conducto',
];

const EGRESO_CATEGORY_PATTERNS = [
  { categoria: 'sueldos', pattern: /sueld/i },
  { categoria: 'honorarios', pattern: /honorario/i },
  { categoria: 'insumos', pattern: /insumo|guante|bracket|anestesia|material/i },
  { categoria: 'alquiler', pattern: /alquiler/i },
  { categoria: 'expensas', pattern: /expensa/i },
  { categoria: 'servicios', pattern: /luz|agua|internet|telefono|servicio/i },
  { categoria: 'impuestos', pattern: /impuesto|iva|ingresos\s+brutos|ganancia|monotributo/i },
  { categoria: 'mantenimiento', pattern: /mantenimiento|autoclave|rayos\s*x|sillon|equipo|reparacion/i },
  { categoria: 'software', pattern: /software|sistema|licencia|suscripcion/i },
];

function limpiarEntidad(text) {
  return capitalizarFrase(
    String(text || '')
      .replace(/[.,;:!?]+$/g, '')
      .replace(/^(?:de|del|a|al|con|por|para|paciente|proveedor)\s+/i, '')
      .trim()
  );
}

function extraerProfesional(rawText) {
  const patterns = [
    /\bcon\s+((?:dra?\.?|doctora|doctor)\s+[a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})\b/i,
    /\b((?:dra?\.?|doctora|doctor)\s+[a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})\b/i,
  ];

  for (const pattern of patterns) {
    const match = String(rawText || '').match(pattern);
    if (!match) continue;
    const value = match[1] || match[0];
    const normalized = value
      .replace(/^(?:con\s+)?/i, '')
      .replace(/\bdoctora\b/i, 'Dra')
      .replace(/\bdoctor\b/i, 'Dr')
      .replace(/\bdra?\.?/i, m => m.toLowerCase().startsWith('dra') ? 'Dra' : 'Dr');
    return capitalizarFrase(normalized);
  }

  return null;
}

function extraerTratamiento(rawText, categoria = null) {
  const original = String(rawText || '').trim();
  if (!original) return null;

  for (const keyword of TRATAMIENTO_KEYWORDS) {
    const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i');
    const match = original.match(regex);
    if (match) return capitalizarFrase(match[0]);
  }

  if (categoria === 'consulta') return null;

  const byConnector = original.match(/\b(?:por|para|tratamiento|servicio)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3})\b/i);
  if (byConnector && byConnector[1]) {
    const cleaned = byConnector[1]
      .replace(/\b(?:con|efectivo|transferencia|tarjeta|usd|u\$|pesos?)\b.*$/i, '')
      .trim();
    return capitalizarFrase(cleaned);
  }

  return null;
}

function extraerPaciente(rawText, categoria = null, tratamientoNombre = null, profesionalNombre = null) {
  const original = String(rawText || '').trim();
  if (!original) return null;

  const patterns = [
    /\b(?:de|a|paciente)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3})\b/i,
    /^(?:consulta|anticipo|cuota|saldo(?:\s+final)?|pendiente)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3})\b/i,
  ];

  for (const pattern of patterns) {
    const match = original.match(pattern);
    if (!match || !match[1]) continue;
    let candidate = match[1]
      .replace(/\b(?:por|para|con|efectivo|transferencia|tarjeta)\b.*$/i, '')
      .trim();
    if (tratamientoNombre) {
      candidate = candidate.replace(new RegExp(`\\b${escapeRegex(tratamientoNombre)}\\b`, 'i'), '').trim();
    }
    if (profesionalNombre) {
      candidate = candidate.replace(new RegExp(`\\b${escapeRegex(profesionalNombre)}\\b`, 'i'), '').trim();
    }
    candidate = candidate.replace(/\b(?:dra?\.?|dr\.?|doctora|doctor)\b.*$/i, '').trim();
    const cleaned = limpiarEntidad(candidate);
    if (cleaned) return cleaned;
  }

  if (categoria === 'consulta') {
    const fallback = original.match(/^consulta\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})\b/i);
    if (fallback && fallback[1]) return limpiarEntidad(fallback[1]);
  }

  return null;
}

function extraerProveedor(rawText) {
  const original = String(rawText || '').trim();
  if (!original) return null;

  const patterns = [
    /\b(?:a|proveedor)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3})\b/i,
  ];

  for (const pattern of patterns) {
    const match = original.match(pattern);
    if (!match || !match[1]) continue;
    const candidate = match[1]
      .replace(/\b(?:por|para|con|efectivo|transferencia|tarjeta)\b.*$/i, '')
      .trim();
    const cleaned = limpiarEntidad(candidate);
    if (cleaned) return cleaned;
  }

  return null;
}

function inferirCategoriaRapida(tipo, descripcion = '', estado = 'Cobrado', rawText = '') {
  const desc = normalizar(descripcion).replace(/_/g, ' ');
  const original = normalizar(rawText).replace(/_/g, ' ');
  const source = `${original} ${desc}`.trim();

  if (estado === 'Pendiente') return 'cobro_pendiente';
  if (tipo === 'gasto') {
    for (const rule of EGRESO_CATEGORY_PATTERNS) {
      if (rule.pattern.test(desc)) return rule.categoria;
    }
    return 'otro_egreso';
  }

  if (/consulta/.test(source)) return 'consulta';
  if (/anticipo|adelanto/.test(source)) return 'anticipo';
  if (/sena|seña|reserva/.test(source)) return 'sena';
  if (/cuota/.test(source)) return 'cuota';
  if (/saldo(?:\s+final)?/.test(source)) return 'saldo_final';
  return 'tratamiento';
}

function limpiarDescripcionMovimiento(text) {
  return String(text || '')
    .replace(/^(?:se\s+le\s+|le\s+)?/i, '')
    .replace(/^(?:a|al|de|del)\s+/i, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
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

function matchRegistrarEgresoExplicito(rawText, text) {
  const expensePattern = /^(?:se\s+le\s+pago\s+a|se\s+le\s+pag[oó]\s+a|le\s+pague\s+a|le\s+pagu[eé]\s+a|pague\s+a|pagu[eé]\s+a|abone\s+a|abon[eé]\s+a)\s+(.+)$/i;
  const match = String(rawText || '').trim().match(expensePattern);
  if (!match || !match[1]) return null;

  const montoInfo = extraerMonto(rawText);
  const metodo_pago = extraerMetodo(text);
  const descripcion = capitalizarFrase(limpiarDescripcionMovimiento(extraerDescripcion(rawText, 'gasto', metodo_pago)));
  const proveedorNombre = extraerProveedor(rawText);

  return {
    intent: 'registrar_movimiento',
    entities: {
      tipo: 'gasto',
      descripcion,
      monto: montoInfo ? montoInfo.monto : null,
      moneda: montoInfo ? montoInfo.moneda : 'Pesos',
      metodo_pago,
       categoria: inferirCategoriaRapida('gasto', descripcion, 'Cobrado', rawText),
      proveedorNombre,
    }
  };
}

function matchRegistrarIngresoExplicito(rawText, text) {
  const incomePattern = /^(?:me\s+pagaron|me\s+abonaron|me\s+depositaron|me\s+transfirieron|cayo\s+lo\s+de|cay[oó]\s+lo\s+de)\s+(.+)$/i;
  const match = String(rawText || '').trim().match(incomePattern);
  if (!match || !match[1]) return null;

  const montoInfo = extraerMonto(rawText);
  const metodo_pago = extraerMetodo(text);
  const descripcion = capitalizarFrase(limpiarDescripcionMovimiento(extraerDescripcion(rawText, 'ingreso', metodo_pago)));
  const categoria = inferirCategoriaRapida('ingreso', descripcion, 'Cobrado', rawText);
  const profesionalNombre = extraerProfesional(rawText);
  const tratamientoNombre = extraerTratamiento(rawText, categoria);
  const pacienteNombre = extraerPaciente(rawText, categoria, tratamientoNombre, profesionalNombre);

  return {
    intent: 'registrar_movimiento',
    entities: {
      tipo: 'ingreso',
      descripcion,
      monto: montoInfo ? montoInfo.monto : null,
      moneda: montoInfo ? montoInfo.moneda : 'Pesos',
      metodo_pago,
      categoria,
      pacienteNombre,
      profesionalNombre,
      tratamientoNombre,
    }
  };
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
    if (/^(cobre|cobro|pago|gaste|gasto|pague|ingrese|ingreso|ingresaron|cargue|cargo|facture|facturo|recibi|compre|sali|egrese|egreso|consulta|servicio|entro|entraron|entrada|salio|salieron|fueron|vendi|depositaron|transferieron|abone|abonar|cayo|cayo|entro|seña|sena|honorario|honorarios|cobranza)$/i.test(wNorm)) continue;
    if (metodo === 'efectivo' && /^(efectivo|contado|cash)$/.test(wNorm)) continue;
    if (metodo === 'transferencia' && /^(transferencia|transfer|transf|tf|tbu|cbu|alias|mercadopago|mp|qr)$/.test(wNorm)) continue;
    if (metodo === 'tarjeta' && /^(tarjeta|debito|credito|visa|master|mc|posnet)$/.test(wNorm)) continue;
    if (/^(de|del|en|la|el|lo|los|las|con|por|se|me|te|le|al|ya|un|una|pesos|mangos|guita|plata|dolares?|usd)$/.test(wNorm)) continue;

    cleanWords.push(wordsOrig[i]);
  }

  const result = cleanWords.join(' ').replace(/[.,;:!?]/g, '').trim();
  if (result.length < 2) return null;
  const words = result.split(' ').filter(w => w.length > 1);
  return words.length > 0 ? words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : null;
}

const KEYWORD_INTENTS = [
  { intent: 'ver_balance', words: ['balance', 'resumen de caja', 'estado de caja', 'caja', 'neto'], phrases: ['cuanto tengo', 'como estoy', 'como va la caja', 'que tengo', 'como va', 'como ando', 'cuanto hice', 'resumen general', 'estado general', 'como venimos'] },
  { intent: 'ver_hoy', words: [], phrases: ['que hubo hoy', 'movimientos de hoy', 'que cobre hoy', 'cobros de hoy', 'como le fue hoy', 'como estuvo hoy', 'como va hoy', 'que paso hoy', 'que hubo', 'lo de hoy', 'hoy como vamos', 'cuanto hice hoy'] },
  { intent: 'ver_semana', words: [], phrases: ['como va la semana', 'movimientos de la semana', 'esta semana', 'resumen semanal', 'resumen de la semana', 'que cobre esta semana', 'como va la sem', 'la semana', 'cuanto hice esta semana'] },
  { intent: 'ver_mes', words: [], phrases: ['como va el mes', 'movimientos del mes', 'este mes', 'resumen mensual', 'resumen del mes', 'que cobre este mes', 'el mes', 'cuanto hice este mes', 'como venimos este mes'] },
  { intent: 'ver_ingresos', words: ['ingresos', 'cobros', 'entradas'], phrases: ['que cobre', 'mis ingresos', 'lista de ingresos', 'ver ingresos', 'mostrar ingresos', 'los ingresos', 'lo que entro', 'lo que entró', 'ver cobros'] },
  { intent: 'ver_egresos', words: ['egresos'], phrases: ['mis gastos', 'lista de egresos', 'ver egresos', 'ver gastos', 'mostrar gastos', 'que gaste', 'los gastos', 'mis egresos', 'lo que salio', 'lo que salió', 'cuanto gaste'] },
  { intent: 'ver_pendientes', words: ['pendientes', 'deudores'], phrases: ['que me falta cobrar', 'sin cobrar', 'adeudados', 'sin pagar', 'por cobrar', 'ver pendientes', 'mostrar pendientes', 'quienes me deben', 'quienes no pagaron', 'me deben', 'que quedo debiendo', 'que quedó debiendo'] },
  { intent: 'ver_dolar', words: ['cotizacion', 'coti', 'dolar'], phrases: ['cuanto vale el dolar', 'dolar blue', 'precio dolar', 'valor dolar', 'cuanto esta el dolar', 'a cuanto esta el dolar', 'cuanto el dolar', 'cotizacion del dolar', 'valor del dolar', 'precio del dolar'] },
  { intent: 'actualizardolar', words: [], phrases: ['actualizar dolar', 'actualizar cotizacion', 'actualizar coti', 'nueva coti', 'actualiza dolar', 'update dolar', 'actualizar el dolar', 'actualizar la cotizacion'] },
  { intent: 'ver_sheet', words: ['sheet', 'sheets'], phrases: ['mi sheet', 'abrir sheet', 'ver sheet', 'mi google sheet', 'abrir google sheet'] },
  { intent: 'ver_ayuda', words: ['ayuda', 'help'], phrases: ['como funciona', 'que puedo hacer', 'que haces', 'comandos'] },
  { intent: 'listar_movimientos', words: ['listar', 'listado'], phrases: ['ver todo', 'ver movimientos', 'todos los movimientos', 'ver todos', 'lista de movimientos', 'lista completa', 'ver lista'] },
];

const INGRESO_WORDS = ['cobre', 'cobro', 'me pagaron', 'me pago', 'pagaron', 'se cobro', 'se cobraron', 'se pago', 'se pagaron', 'ingrese', 'ingreso', 'ingresaron', 'cargue', 'cargo', 'facture', 'facturo', 'recibi', 'consulta', 'servicio', 'anticipo', 'adelanto', 'seño', 'seña', 'sena', 'cuota', 'saldo', 'saldo final', 'atendi', 'entro', 'entraron', 'me entro', 'me entraron', 'cobraron', 'cobramos', 'depositaron', 'transferieron', 'vendi', 'vendio', 'cobraste', 'cobro', 'pagamos', 'cayo', 'cayo lo de', 'entró', 'me entró', 'honorarios', 'honorario', 'liquide', 'liquidaron'];

const EGRESO_WORDS = ['gaste', 'gasto', 'se gasto', 'pague', 'costo de', 'compre', 'compra', 'sali', 'salida', 'egrese', 'egreso', 'salio', 'salieron', 'se fue', 'se me fue', 'costo', 'erogo', 'abone', 'aboné', 'puse', 'inverti', 'invertí', 'debite', 'debité'];

function matchKeywordIntent(text) {
  let bestMatch = null;

  for (const { intent, words, phrases } of KEYWORD_INTENTS) {
    for (const phrase of phrases) {
      if (containsNormalizedTerm(text, phrase)) {
        const score = normalizar(phrase).length;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { intent, score };
        }
      }
    }
    for (const word of words) {
      if (containsNormalizedTerm(text, word)) {
        const score = normalizar(word).length;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { intent, score };
        }
      }
    }
  }
  return bestMatch ? bestMatch.intent : null;
}

const ENTITY_INTENTS = [
  { intent: 'cobrar_movimiento', patterns: [/^(?:cobrar|cobro|ya me pago|ya me pagaron|ya cobro|marcar cobrado|marcar como cobrado|ya cobre|ya pago|cobrale|cobra|me pago|me pag[oó]|ya entro lo de|entro lo de|entr[oó] lo de|me transfirio|me transfiri[oó]|me deposito|me deposit[oó]|cayo lo de|cay[oó] lo de|liquidaron|me abonaron)\s+(.+)$/i, /^(.+?)\s+(?:me pago|me pag[oó]|me transfirio|me transfiri[oó]|me deposito|me deposit[oó]|me abon[oó])$/i], entityKey: 'nombre' },
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
  const profesionalNombre = extraerProfesional(rawText);
  const tratamientoNombre = extraerTratamiento(rawText, 'cobro_pendiente');
  const pacienteNombre = extraerPaciente(rawText, 'cobro_pendiente', tratamientoNombre, profesionalNombre) || descripcion;

  return {
    intent: 'registrar_movimiento',
    entities: {
      tipo: 'ingreso',
      descripcion,
      monto: montoInfo ? montoInfo.monto : null,
      moneda: montoInfo ? montoInfo.moneda : 'Pesos',
      metodo_pago,
      estado: 'Pendiente',
      categoria: 'cobro_pendiente',
      pacienteNombre,
      profesionalNombre,
      tratamientoNombre,
    }
  };
}

function matchRegistrarMovimiento(rawText, text) {
  const montoInfo = extraerMonto(rawText);
  const monto = montoInfo ? montoInfo.monto : null;
  const moneda = montoInfo ? montoInfo.moneda : 'Pesos';

  let tipo = null;
  for (const word of EGRESO_WORDS) {
    if (containsNormalizedTerm(text, word)) {
      tipo = 'gasto';
      break;
    }
  }
  if (!tipo) {
    for (const word of INGRESO_WORDS) {
      if (containsNormalizedTerm(text, word)) { tipo = 'ingreso'; break; }
    }
  }
  if (!tipo) return null;

  const metodo_pago = extraerMetodo(text);
  const descripcion = extraerDescripcion(rawText, tipo, metodo_pago);
  const categoria = inferirCategoriaRapida(tipo, descripcion, 'Cobrado', rawText);
  const profesionalNombre = tipo === 'ingreso' ? extraerProfesional(rawText) : null;
  const tratamientoNombre = tipo === 'ingreso' ? extraerTratamiento(rawText, categoria) : null;
  const pacienteNombre = tipo === 'ingreso' ? extraerPaciente(rawText, categoria, tratamientoNombre, profesionalNombre) : null;
  const proveedorNombre = tipo === 'gasto' ? extraerProveedor(rawText) : null;

  return {
    intent: 'registrar_movimiento',
    entities: {
      tipo,
      descripcion,
      monto,
      moneda,
      metodo_pago,
      categoria,
      pacienteNombre,
      profesionalNombre,
      tratamientoNombre,
      proveedorNombre,
    }
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

  const egresoExplicito = matchRegistrarEgresoExplicito(rawText, text);
  if (egresoExplicito) return egresoExplicito;

  const ingresoExplicito = matchRegistrarIngresoExplicito(rawText, text);
  if (ingresoExplicito) return ingresoExplicito;

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
