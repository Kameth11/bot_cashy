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
  // Euros first to avoid ambiguity with $
  const euroPatterns = [
    /€\s*(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/i,
    /(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?\s*€/i,
    /eur\s*(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/i,
    /(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?\s+euros?\b/i,
  ];
  for (const p of euroPatterns) {
    const m = rawText.match(p);
    if (m && m[1]) {
      const val = normalizarNumero(`${m[1]}${m[2] ? ` ${m[2]}` : ''}`);
      if (val && val > 0) return { monto: val, moneda: 'Euros' };
    }
  }

  // USD
  const usdPatterns = [
    /u\$s?\s*(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/i,
    /usd\s*(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/i,
    /(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es?)?)?\s+d[oó]lares?\b/i,
  ];
  for (const p of usdPatterns) {
    const m = rawText.match(p);
    if (m && m[1]) {
      const val = normalizarNumero(`${m[1]}${m[2] ? ` ${m[2]}` : ''}`);
      if (val && val > 0) return { monto: val, moneda: 'Dólares' };
    }
  }

  // Pesos and generic amounts
  const pesoPatterns = [
    /\$\s*(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/i,
    /(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)\b/i,
    /(\d+(?:[.,]\d{1,2})?)\s*(?:pesos|mangos|guita|plata|d[oó]lares?|usd)/i,
  ];
  for (const p of pesoPatterns) {
    const m = rawText.match(p);
    if (m && m[1]) {
      const val = normalizarNumero(`${m[1]}${m[2] ? ` ${m[2]}` : ''}`);
      if (val && val > 0) {
        const isUsd = /u\$s?|usd|d[oó]lar/i.test(rawText.substring(Math.max(0, m.index - 5), m.index + m[0].length + 5));
        return { monto: val, moneda: isUsd ? 'Dólares' : 'Pesos' };
      }
    }
  }

  const simple = rawText.match(/\b(\d+(?:[.,]\d{1,2})?)\s*(lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?\b/i);
  if (simple && simple[1]) {
    const val = normalizarNumero(`${simple[1]}${simple[2] ? ` ${simple[2]}` : ''}`);
    if (val && val > 0) {
      const isUsd = /u\$s?|usd|d[oó]lar/i.test(rawText);
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
    .replace(/€\s*\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/gi, ' ')
    .replace(/\d+(?:[.,]\d{1,2})?\s*€/gi, ' ')
    .replace(/eur\s*\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/gi, ' ')
    .replace(/u\$s?\s*\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/gi, ' ')
    .replace(/usd\s*\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/gi, ' ')
    .replace(/\$\s*\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/gi, ' ')
    .replace(/\b\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?\b/gi, ' ')
    .replace(/\b(?:pesos|mangos|guita|plata|dolares?|usd|euros?|eur)\b/gi, ' ')
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
  // Cirugía e implantes
  'implante',
  'implantologia',
  'implantología',
  'cirugia',
  'cirugía',
  // Ortodoncia
  'ortodoncia',
  'brackets',
  'retenedor',
  'contencion',
  'contención',
  'alineador',
  'invisalign',
  // Endodoncia
  'endodoncia',
  'conducto',
  'tratamiento de conducto',
  'perno',
  // Prótesis y coronas
  'corona',
  'protesis',
  'prótesis',
  'carilla',
  'incrustacion',
  'incrustación',
  'puente',
  'retenedor',
  'zirconia',
  'porcelana',
  // Periodoncia
  'limpieza',
  'raspado',
  'periodoncia',
  'encias',
  'encías',
  'tratamiento periodontal',
  // Blanqueamiento
  'blanqueamiento',
  'blanqueo',
  // Operatoria
  'caries',
  'obturacion',
  'obturación',
  'composite',
  'amalgama',
  'sellante',
  // Extracciones
  'extraccion',
  'extracción',
  'muela del juicio',
  'cordal',
  // Consulta
  'consulta',
  'revision',
  'revisión',
  'rx',
  'radiografia',
  'radiografía',
  // Odontopediatría
  'pediatrica',
  'pediátrica',
  'sellador',
  'corona de acero',
  'fluor',
  'flúor',
];

const EGRESO_CATEGORY_PATTERNS = [
  { categoria: 'sueldos', pattern: /sueld|sueldo|emplead|asistente|recepcionista|secretaria/i },
  { categoria: 'honorarios', pattern: /honorario|honorarios/i },
  { categoria: 'insumos', pattern: /insumo|guante|bracket|anestesia|material|cartucho|aguja|jeringa|algod[oó]n|hilo|sutura|composite|amalgama|cemento|yeso|alginato|silicona|fresas?|turbina|pieza\s+de\s+mano/i },
  { categoria: 'alquiler', pattern: /alquiler/i },
  { categoria: 'expensas', pattern: /expensa/i },
  { categoria: 'servicios', pattern: /luz|agua|internet|telefono|tel[eé]fono|gas|servicio|celular|fibra/i },
  { categoria: 'impuestos', pattern: /impuesto|iva|ingresos\s+brutos|ganancia|monotributo|afip|arba|agip|tributo/i },
  { categoria: 'mantenimiento', pattern: /mantenimiento|autoclave|esterilizaci[oó]n|rayos\s*x|sillon|equipo|reparaci[oó]n|plomero|gasista|electricista|técnico|tecnico|limpiezas?/i },
  { categoria: 'software', pattern: /software|sistema|licencia|suscripcion|suscripción|turno|odontograma|crm|gestion|gestión/i },
  { categoria: 'otro_egreso', pattern: /farmacia|medicamento|medicaci[oó]n/i },
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

  if (categoria === 'consulta') return 'Consulta';

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
    /^([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3})\s+vino\b/i,
    /^(?:vino|vinieron)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3})\b/i,
    /^(?:le\s+pagaron|le\s+abonaron|le\s+depositaron|le\s+transfirieron|me\s+pagaron|me\s+abonaron|me\s+depositaron|me\s+transfirieron)\s+a\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3}?)(?=\s+(?:de|por|en|efectivo|transferencia|tarjeta|contado|cash|\$|u\$s?|usd|\d)|$)/i,
    /\b(?:de|a|paciente)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3})\b/i,
    /^(?:consulta|anticipo|cuota|saldo(?:\s+final)?|pendiente)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3})\b/i,
    /^([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3})\s+me\s+(?:pag[oó]|transfiri[oó]|deposit[oó]|abon[oó])(?:\s|$)/i,
  ];

  for (const pattern of patterns) {
    const match = original.match(pattern);
    if (!match || !match[1]) continue;
    let candidate = match[1]
      .replace(/\b(?:por|para|con|en|efectivo|transferencia|tarjeta|contado|cash)\b.*$/i, '')
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

function extraerPagador(rawText, destinatarioNombre = null) {
  const original = String(rawText || '').trim();
  if (!original) return null;

  let remainder = original;
  if (destinatarioNombre) {
    const destinatarioRegex = new RegExp(`\\b${escapeRegex(destinatarioNombre)}\\b`, 'i');
    const destinatarioMatch = remainder.match(destinatarioRegex);
    if (destinatarioMatch && typeof destinatarioMatch.index === 'number') {
      remainder = remainder.slice(destinatarioMatch.index + destinatarioMatch[0].length);
    }
  }

  remainder = remainder
    .replace(/u\$s?\s*\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/gi, ' ')
    .replace(/usd\s*\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/gi, ' ')
    .replace(/\$\s*\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?/gi, ' ')
    .replace(/\b\d+(?:[.,]\d{1,2})?\s*(?:lucas?|luca|mil|k|palos?|palo|millon(?:es)?)?\b/gi, ' ')
    .replace(/\b(?:pesos|mangos|guita|plata|dolares?|usd|efectivo|contado|cash|transferencia|transfer|transf|tf|tbu|cbu|alias|deposito|mercadopago|mercado\s*pago|mp|qr|tarjeta|debito|credito|visa|master|mc|posnet)\b/gi, ' ')
    .replace(/[.,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const match = remainder.match(/\b(?:de|por)\s+([a-z0-9áéíóúñ]+(?:\s+[a-z0-9áéíóúñ]+){0,3})\b/i)
    || original.match(/\b(?:de|por)\s+([a-z0-9áéíóúñ]+(?:\s+[a-z0-9áéíóúñ]+){0,3})\b/i);

  if (!match || !match[1]) return null;

  const cleaned = limpiarEntidad(
    match[1]
      .replace(/\b(?:en|efectivo|transferencia|tarjeta|contado|cash)\b.*$/i, '')
      .trim()
  );

  return cleaned || null;
}

function limpiarDescripcionConActores(descripcion, pacienteNombre = null, pagadorNombre = null) {
  let candidate = String(descripcion || '').trim();
  if (!candidate) return pacienteNombre || null;

  if (pagadorNombre) {
    candidate = candidate.replace(new RegExp(`\\b${escapeRegex(pagadorNombre)}\\b`, 'i'), ' ').replace(/\s+/g, ' ').trim();
  }

  candidate = candidate.replace(/\b(?:de|del)\b$/i, '').replace(/\s+/g, ' ').trim();
  if (!candidate) return pacienteNombre || null;

  if (pacienteNombre && normalizar(candidate) === normalizar(pacienteNombre)) {
    return pacienteNombre;
  }

  return candidate;
}

function extraerProveedor(rawText) {
  const original = String(rawText || '').trim();
  if (!original) return null;

  const patterns = [
    /\b(?:al?|proveedor)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3})\b/i,
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

function tieneContextoClinico(rawText) {
  const normalized = normalizar(rawText);
  if (/\b(?:consulta|servicio|tratamiento|anticipo|cuota|saldo(?:\s+final)?)\b/.test(normalized)) {
    return true;
  }

  return TRATAMIENTO_KEYWORDS.some(keyword => containsNormalizedTerm(normalized, keyword));
}

function matchPagoEntreTerceros(rawText, text) {
  const match = String(rawText || '').trim().match(/^([a-záéíóúñ.]+(?:\s+[a-záéíóúñ.]+){0,3})\s+le\s+(?:pag[oó]|abon[oó]|deposit[oó]|transfiri[oó])\s+a(?:l)?\s+([a-záéíóúñ.]+(?:\s+[a-záéíóúñ.]+){0,3})(?=\s|$)/i);
  if (!match || !match[1] || !match[2]) return null;

  const actorOrigen = limpiarEntidad(match[1]);
  const actorDestino = limpiarEntidad(match[2]);
  if (!actorOrigen || !actorDestino) return null;

  const montoInfo = extraerMonto(rawText);
  const metodo_pago = extraerMetodo(text);

  if (tieneContextoClinico(rawText)) {
    const categoria = inferirCategoriaRapida('ingreso', actorOrigen, 'Cobrado', rawText);
    const tratamientoNombre = extraerTratamiento(rawText, categoria);

    return {
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        descripcion: actorOrigen,
        monto: montoInfo ? montoInfo.monto : null,
        moneda: montoInfo ? montoInfo.moneda : 'Pesos',
        metodo_pago,
        categoria,
        pacienteNombre: actorOrigen,
        pagadorNombre: actorOrigen,
        profesionalNombre: actorDestino,
        tratamientoNombre,
      }
    };
  }

  return {
    intent: 'registrar_movimiento',
    entities: {
      tipo: 'gasto',
      descripcion: actorDestino,
      monto: montoInfo ? montoInfo.monto : null,
      moneda: montoInfo ? montoInfo.moneda : 'Pesos',
      metodo_pago,
      categoria: inferirCategoriaRapida('gasto', actorDestino, 'Cobrado', rawText),
      proveedorNombre: actorDestino,
    }
  };
}

function inferirCategoriaRapida(tipo, descripcion = '', estado = 'Cobrado', rawText = '') {
  const desc = normalizar(descripcion || '').replace(/_/g, ' ');
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
  const expensePattern = /^(?:se\s+le\s+pago\s+a(?:l)?|se\s+le\s+pag[oó]\s+a(?:l)?|le\s+pague\s+a(?:l)?|le\s+pagu[eé]\s+a(?:l)?|pague\s+a(?:l)?|pagu[eé]\s+a(?:l)?|abone\s+a(?:l)?|abon[eé]\s+a(?:l)?|le\s+pagamos\s+a(?:l)?|pagamos\s+a(?:l)?)\s+(.+)$/i;
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
  const incomePattern = /^(?:me\s+pagaron|me\s+abonaron|me\s+depositaron|me\s+transfirieron|le\s+pagaron|le\s+abonaron|le\s+depositaron|le\s+transfirieron|cayo\s+lo\s+de|cay[oó]\s+lo\s+de)\s+(.+)$/i;
  const match = String(rawText || '').trim().match(incomePattern);
  if (!match || !match[1]) return null;

  const montoInfo = extraerMonto(rawText);
  const metodo_pago = extraerMetodo(text);
  const descripcionBase = capitalizarFrase(limpiarDescripcionMovimiento(extraerDescripcion(rawText, 'ingreso', metodo_pago)));
  const profesionalNombre = extraerProfesional(rawText);
  const pacienteNombre = extraerPaciente(rawText, null, null, profesionalNombre);
  const pagadorNombre = extraerPagador(rawText, pacienteNombre);
  const descripcion = limpiarDescripcionConActores(descripcionBase, pacienteNombre, pagadorNombre);
  const categoria = inferirCategoriaRapida('ingreso', descripcion, 'Cobrado', rawText);
  const tratamientoNombre = extraerTratamiento(rawText, categoria);
  const pacienteFinal = extraerPaciente(rawText, categoria, tratamientoNombre, profesionalNombre) || pacienteNombre;
  const pagadorFinal = extraerPagador(rawText, pacienteFinal) || pagadorNombre;

  return {
    intent: 'registrar_movimiento',
    entities: {
      tipo: 'ingreso',
      descripcion,
      monto: montoInfo ? montoInfo.monto : null,
      moneda: montoInfo ? montoInfo.moneda : 'Pesos',
      metodo_pago,
      categoria,
      pacienteNombre: pacienteFinal,
      pagadorNombre: pagadorFinal,
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
    if (/^(pesos|mangos|guita|plata|dola?r(?:es)?|usd|euros?|eur|\$|u\$s?|€|lucas?|luca|mil|k|palos?|palo|millon(?:es)?)$/.test(wNorm)) continue;
    if (allTipoWords.some(tw => wNorm === normalizar(tw))) continue;
    if (/^(cobre|cobro|pago|gaste|gasto|pague|ingrese|ingreso|ingresaron|cargue|cargo|facture|facturo|recibi|compre|sali|egrese|egreso|consulta|servicio|entro|entraron|entrada|salio|salieron|fueron|vendi|depositaron|transferieron|transfirieron|abone|abonar|cayo|cayo|entro|seña|sena|honorario|honorarios|cobranza)$/i.test(wNorm)) continue;
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

const INGRESO_WORDS = ['cobre', 'cobro', 'me pagaron', 'me pago', 'le pagaron', 'pagaron', 'se cobro', 'se cobraron', 'se pago', 'se pagaron', 'ingrese', 'ingreso', 'ingresaron', 'cargue', 'cargo', 'facture', 'facturo', 'recibi', 'consulta', 'servicio', 'anticipo', 'adelanto', 'seño', 'seña', 'sena', 'cuota', 'saldo', 'saldo final', 'atendi', 'vino', 'vinieron', 'entro', 'entraron', 'me entro', 'me entraron', 'cobraron', 'cobramos', 'depositaron', 'le depositaron', 'transferieron', 'transfirieron', 'le transfirieron', 'vendi', 'vendio', 'cobraste', 'cobro', 'cayo', 'cayo lo de', 'entró', 'me entró', 'honorarios', 'honorario', 'liquide', 'liquidaron'];

const EGRESO_WORDS = ['gaste', 'gasto', 'se gasto', 'pague', 'costo de', 'compre', 'compra', 'sali', 'salida', 'egrese', 'egreso', 'salio', 'salieron', 'se fue', 'se me fue', 'costo', 'erogo', 'abone', 'aboné', 'puse', 'inverti', 'invertí', 'debite', 'debité', 'pagamos'];

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
  const descripcionBase = extraerDescripcion(rawText, tipo, metodo_pago);
  const profesionalNombre = tipo === 'ingreso' ? extraerProfesional(rawText) : null;
  const pacienteBase = tipo === 'ingreso' ? extraerPaciente(rawText, null, null, profesionalNombre) : null;
  const pagadorBase = tipo === 'ingreso' ? extraerPagador(rawText, pacienteBase) : null;
  const descripcion = tipo === 'ingreso'
    ? limpiarDescripcionConActores(descripcionBase, pacienteBase, pagadorBase)
    : descripcionBase;
  const categoria = inferirCategoriaRapida(tipo, descripcion, 'Cobrado', rawText);
  const tratamientoNombre = tipo === 'ingreso' ? extraerTratamiento(rawText, categoria) : null;
  const pacienteNombre = tipo === 'ingreso' ? extraerPaciente(rawText, categoria, tratamientoNombre, profesionalNombre) || pacienteBase : null;
  const pagadorNombre = tipo === 'ingreso' ? extraerPagador(rawText, pacienteNombre) || pagadorBase : null;
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
      pagadorNombre,
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

// ── Cobro parcial con deuda residual ─────────────────────────────────────────
// Cubre: "pagaron 30000 y debe 30000", "cobré 20k y le quedan 15000",
//        "Juan pagó 10000 pero me sigue debiendo 20000",
//        "pagaron 300 euros y faltan 200 restantes",
//        "pagaron 300 euros y faltan 200 más", etc.
// Retorna intent `cobro_parcial_con_deuda` con dos montos y el nombre.
function matchCobroParcialConDeuda(rawText, text) {
  // Verbos de cobro que inician el patrón
  const VERBOS_COBRO = 'pag[oó]|pagaron|abon[oó]|abonaron|deposit[oó]|depositaron|transfirio|transfiri[oó]|transfirieron|cobr[eé]|cobramos|entregaron?|dio|dieron?';

  // Verbos/frases que introducen la deuda restante
  const VERBOS_DEUDA = 'debe[n]?|queda[n]?\\s*(?:debiendo)?|queda\\s+debiendo|siguen?\\s+debiendo|resta[n]?|le\\s+queda[n]?|le\\s+falta[n]?|falta[n]?(?:\\s+(?:abonar|cobrar|pagar))?|adeuda[n]?|est[aá]n?\\s+pendiente[s]?|hay\\s+pendiente[s]?|por\\s+cobrar|por\\s+pagar';

  // Patrón 1: con conector explícito (y/pero/aunque)
  // "pagaron 300 y faltan 200", "cobré 50 pero deben 150"
  const patron1 = new RegExp(
    `^(.*?)\\s*(?:me\\s+)?(?:${VERBOS_COBRO})\\s+(.+?)\\s+(?:y|pero|aunque)\\s+(?:todav[ií]a\\s+)?(?:me\\s+)?(?:${VERBOS_DEUDA})\\s+(.+)$`,
    'i'
  );

  // Patrón 2: sin conector — el VERBO_DEUDA aparece directamente después del primer monto
  // "pagaron 500k de ortodoncia mariana en efectivo faltan 1 millon"
  // "cobré 300 euros transferencia falta 200"
  const patron2 = new RegExp(
    `^(.*?)\\s*(?:me\\s+)?(?:${VERBOS_COBRO})\\s+(.+?)\\s+(?:${VERBOS_DEUDA})\\s+(.+)$`,
    'i'
  );

  const match = rawText.trim().match(patron1) || rawText.trim().match(patron2);
  if (!match) return null;

  const nombreRaw = match[1].trim();
  const partePagada = match[2].trim();
  // Limpiar calificadores que van DESPUÉS del número de deuda
  const parteDeuda = match[3].trim()
    .replace(/\s+(?:restantes?|más?|mas|pendientes?|aun|aún|por\s+cobrar|por\s+pagar)$/i, '')
    .trim();

  const montoPagado = extraerMonto(partePagada);
  const montoDeuda  = extraerMonto(parteDeuda);

  if (!montoPagado || !montoDeuda) return null;

  // Inferir moneda de la deuda si no tiene marcador explícito pero el cobro sí
  const tieneMonedaExplicitaDeuda = /€|euros?|u\$s?|usd|dolares?|\$/.test(parteDeuda);
  if (!tieneMonedaExplicitaDeuda && montoPagado.moneda !== 'Pesos') {
    montoDeuda.moneda = montoPagado.moneda;
  }

  const nombre = limpiarEntidad(nombreRaw) || extraerPaciente(rawText, 'cobro_pendiente', null, null);
  const metodo_pago = extraerMetodo(text);
  const profesionalNombre = extraerProfesional(rawText);
  const tratamientoNombre = extraerTratamiento(rawText, 'tratamiento');

  const descripcionBase = nombre
    ? nombre
    : capitalizarFrase(limpiarTextoPendienteBase(rawText)) || 'Cobro';

  return {
    intent: 'cobro_parcial_con_deuda',
    entities: {
      montoCobrado: montoPagado.monto,
      monedaCobrada: montoPagado.moneda,
      montoDeuda: montoDeuda.monto,
      monedaDeuda: montoDeuda.moneda,
      descripcion: descripcionBase,
      pacienteNombre: nombre || null,
      profesionalNombre,
      tratamientoNombre,
      metodo_pago,
    }
  };
}

// ── Pago sobre un total conocido ──────────────────────────────────────────────
// Cubre: "cobré 300 de 500 euros para ortodoncia de Juan"
//        "pagaron 200 de un total de 1000 para implante"
//        "Juan pagó 400 de 600 dólares"
// Calcula automáticamente la deuda = total - cobrado.
function matchPagoConTotal(rawText, text) {
  const VERBOS_COBRO = 'pag[oó]|pagaron|abon[oó]|abonaron|deposit[oó]|depositaron|transfiri[oó]|transfirieron|cobr[eé]|cobramos|entregaron?|dio|dieron?';

  const patron = new RegExp(
    `^(.*?)\\s*(?:me\\s+)?(?:${VERBOS_COBRO})\\s+(.+?)\\s+de\\s+(?:un\\s+total\\s+de\\s+|total\\s+de\\s+)?(.+)$`,
    'i'
  );

  const match = rawText.trim().match(patron);
  if (!match) return null;

  const nombreRaw  = match[1].trim();
  const parteCobrada = match[2].trim();
  const parteTotal   = match[3].trim();

  // Si la parte "total" contiene indicadores de deuda restante (falta/quedan/restan/etc.),
  // no es un patrón "de X total" — es "falta X" y lo debe manejar matchCobroParcialConDeuda.
  const DEUDA_EN_TOTAL = /\b(?:falta[n]?|resta[n]?|queda[n]?(?:\s+debiendo)?|debe[n]?|adeuda[n]?|pendiente[s]?)\b/i;
  if (DEUDA_EN_TOTAL.test(parteTotal)) return null;

  const montoCobrado = extraerMonto(parteCobrada);
  const montoTotal   = extraerMonto(parteTotal);

  // Ambos deben ser montos válidos y el total tiene que ser mayor
  if (!montoCobrado || !montoTotal) return null;
  if (montoTotal.monto <= montoCobrado.monto) return null;

  // La moneda del total tiene precedencia; si no la tiene, hereda del cobrado
  const moneda = montoTotal.moneda !== 'Pesos' ? montoTotal.moneda : montoCobrado.moneda;
  const montoDeuda = Math.round((montoTotal.monto - montoCobrado.monto) * 100) / 100;

  // Para el nombre, sólo usamos lo que vino antes del verbo — no el rawText completo
  // porque "de X total" sería extraído como nombre por extraerPaciente
  const nombre = limpiarEntidad(nombreRaw) || null;
  const metodo_pago = extraerMetodo(text);
  const profesionalNombre = extraerProfesional(rawText);
  const tratamientoNombre = extraerTratamiento(parteTotal, 'tratamiento')
    || extraerTratamiento(rawText, 'tratamiento');

  const descripcionBase = nombre
    ? nombre
    : capitalizarFrase(limpiarTextoPendienteBase(parteTotal)) || 'Cobro';

  return {
    intent: 'cobro_parcial_con_deuda',
    entities: {
      montoCobrado: montoCobrado.monto,
      monedaCobrada: moneda,
      montoDeuda,
      monedaDeuda: moneda,
      montoTotal: montoTotal.monto,
      descripcion: descripcionBase,
      pacienteNombre: nombre || null,
      profesionalNombre,
      tratamientoNombre,
      metodo_pago,
    }
  };
}

function quickParse(rawText) {
  const text = normalizar(rawText);
  if (!text || text.length < 2) return null;

  if (/^(?:si|no|s|n|yes|y|ok|dale|bueno|vale)$/i.test(text)) return null;

  // Cobro parcial con deuda residual va primero porque contiene dos montos
  // y los matchers generales lo partirían mal
  const cobroParcial = matchCobroParcialConDeuda(rawText, text);
  if (cobroParcial) return cobroParcial;

  // "cobré 300 de 500 euros"
  const pagoConTotal = matchPagoConTotal(rawText, text);
  if (pagoConTotal) return pagoConTotal;

  const pendienteResult = matchRegistrarPendiente(rawText, text);
  if (pendienteResult) return pendienteResult;

  const egresoExplicito = matchRegistrarEgresoExplicito(rawText, text);
  if (egresoExplicito) return egresoExplicito;

  const ingresoExplicito = matchRegistrarIngresoExplicito(rawText, text);
  if (ingresoExplicito) return ingresoExplicito;

  const pagoEntreTerceros = matchPagoEntreTerceros(rawText, text);
  if (pagoEntreTerceros) return pagoEntreTerceros;

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
