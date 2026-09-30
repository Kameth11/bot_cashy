// Lectura de comprobantes con Gemini Vision (fotos y PDFs).
//
// Dos pasos, cada uno una llamada:
// 1. clasificarDocumento: ¿agenda, factura/ticket de gasto, transferencia u
//    otra cosa? Imagen chica y el modelo más barato: se hace con cada foto,
//    incluidas las de agenda.
// 2. extraerFactura: datos del comprobante de gasto (emisor, CUIT, número,
//    fechas, total, ítems).
//
// 3. extraerTransferencia: datos de un comprobante de transferencia recibida
//    (quién pagó, monto, fecha, número de operación).
//
// Las funciones de normalización son puras y se exportan para testearlas sin
// Gemini: el modelo a veces devuelve montos como "45.300,50", fechas en ISO,
// CUIT con o sin guiones, etc.

const { GEMINI_API_KEY, GEMINI_MODEL } = require('../config');
const { getGenAI, getSharp, extractJSON, FALLBACK_MODELS } = require('./vision.service');

const TIPOS_DOCUMENTO = ['agenda', 'factura', 'transferencia', 'otro'];

// Categorías de egreso del consultorio (mismas que el prompt de NLP de texto,
// ver nlp-shared.js). Lo que no calce cae en otro_egreso.
const CATEGORIAS_EGRESO = [
  'insumos', 'alquiler', 'expensas', 'servicios', 'impuestos', 'mantenimiento',
  'software', 'honorarios', 'sueldos', 'otro_egreso',
];

const METODOS_PAGO = ['efectivo', 'transferencia', 'tarjeta'];

const PROMPT_CLASIFICAR = `Mirá la imagen o documento y decí qué es. Respondé solo JSON.

Tipos posibles:
- "agenda": agenda, turnero o planilla de turnos de pacientes (horarios con nombres).
- "factura": factura, ticket, recibo, boleta de servicio (luz, gas, internet), nota de compra o cualquier comprobante de un GASTO o una compra.
- "transferencia": comprobante de transferencia o pago recibido (captura de Mercado Pago, homebanking, billetera virtual) donde alguien le paga a otra persona.
- "otro": cualquier otra cosa.

Formato: {"tipo":"factura","confianza":0.9}
"confianza" entre 0 y 1: qué tan seguro estás.`;

const PROMPT_FACTURA = `Sos un experto en leer comprobantes argentinos (facturas A/B/C, tickets, recibos, boletas de servicios) de un consultorio odontológico o de su dueño. Mirá la imagen o documento y devolvé JSON puro con estas claves exactas:

{
  "tipoDocumento": "factura" | "ticket" | "recibo" | "boleta_servicio" | "otro",
  "letra": "A" | "B" | "C" | null,
  "emisor": razón social o nombre del comercio que EMITE el comprobante (no el cliente),
  "cuit": CUIT del emisor (solo dígitos) o null,
  "numero": número de comprobante como aparece (ej "0003-00001234") o null,
  "fechaEmision": "DD/MM/AAAA" o null,
  "fechaVencimiento": "DD/MM/AAAA" o null (primer vencimiento si hay varios),
  "total": número (el TOTAL final a pagar, sin separadores de miles, punto decimal) o null,
  "moneda": "Pesos" | "Dólares",
  "metodoPago": "efectivo" | "tarjeta" | "transferencia" | null,
  "pagado": true si dice pagado/abonado o es un ticket de compra ya hecha, false si es una factura o boleta a pagar, null si no se sabe,
  "rubro": rubro del emisor en pocas palabras (ej "insumos odontológicos", "supermercado", "combustible", "electricidad", "farmacia", "laboratorio dental"),
  "descripcion": descripción corta del gasto (máx 60 caracteres, ej "Insumos - Dental Sur"),
  "categoria": una de ${CATEGORIAS_EGRESO.join(', ')},
  "items": [{"descripcion": "...", "cantidad": número o null, "precioUnitario": número o null, "subtotal": número o null}]
}

Reglas:
- Si un dato no se ve, usá null. No inventes.
- "total" es el importe final (con impuestos). Si hay "Total" y "Subtotal", usá "Total".
- Los montos argentinos usan punto para miles y coma para decimales: "45.300,50" -> 45300.5.
- Servicios públicos (luz, gas, agua, internet, teléfono) -> categoria "servicios". Materiales o descartables odontológicos -> "insumos". Técnico/laboratorio dental -> "honorarios". AFIP, ingresos brutos, tasas -> "impuestos". Sistemas o suscripciones -> "software".
- items: hasta 30 renglones; si el ticket no detalla ítems, devolvé [].
- Si no es un comprobante de gasto: {"error":"no_es_comprobante"}`;

const PROMPT_TRANSFERENCIA = `Sos un experto en leer comprobantes de transferencias bancarias y pagos de billeteras virtuales argentinas (Mercado Pago, homebanking, Ualá, Brubank, MODO, etc.). El comprobante es de un pago que RECIBE un consultorio odontológico de un paciente. Devolvé JSON puro con estas claves exactas:

{
  "pagador": nombre de quien ENVÍA el dinero (titular de la cuenta de origen / "De" / "Remitente" / "Origen"), o null,
  "cuitPagador": CUIT/CUIL/DNI del pagador (solo dígitos) o null,
  "destinatario": nombre de quien RECIBE el dinero (titular de la cuenta destino / "Para" / "Destino"), o null,
  "monto": número (importe transferido, sin separadores de miles, punto decimal) o null,
  "moneda": "Pesos" | "Dólares",
  "fecha": "DD/MM/AAAA" o null,
  "hora": "HH:MM" o null,
  "banco": banco o billetera (ej "Mercado Pago", "Banco Galicia") o null,
  "numeroOperacion": número o código de operación / referencia / comprobante, o null,
  "concepto": concepto o motivo que escribió quien pagó, o null
}

Reglas:
- No confundas pagador y destinatario: el pagador es quien manda la plata.
- Si un dato no se ve, usá null. No inventes.
- Los montos argentinos usan punto para miles y coma para decimales: "30.000,00" -> 30000.
- Si no es un comprobante de transferencia o pago: {"error":"no_es_transferencia"}`;

// ── Normalización (pura) ─────────────────────────────────────────────────────

function parsearMonto(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  let s = String(value).replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const ultimaComa = s.lastIndexOf(',');
  const ultimoPunto = s.lastIndexOf('.');
  if (ultimaComa > ultimoPunto) {
    // 45.300,50 -> coma decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (ultimoPunto > ultimaComa && ultimaComa !== -1) {
    // 45,300.50 -> punto decimal
    s = s.replace(/,/g, '');
  } else if (ultimaComa === -1 && /\.\d{3}$/.test(s) && (s.match(/\./g) || []).length >= 1) {
    // 45.300 sin decimales -> separador de miles
    s = s.replace(/\./g, '');
  } else {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function parsearFecha(value) {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return formatearFecha(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let anio = Number(m[3]);
    if (anio < 100) anio += 2000;
    return formatearFecha(Number(m[1]), Number(m[2]), anio);
  }
  return null;
}

function formatearFecha(dia, mes, anio) {
  if (!(dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && anio >= 2000 && anio <= 2100)) return null;
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;
}

function normalizarCuit(value) {
  const digitos = String(value || '').replace(/\D/g, '');
  if (digitos.length !== 11) return null;
  return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`;
}

function textoCorto(value, max) {
  if (value == null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max).trim() : s;
}

function normalizarItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 30).map(it => ({
    descripcion: textoCorto(it?.descripcion, 120),
    cantidad: parsearMonto(it?.cantidad),
    precioUnitario: parsearMonto(it?.precioUnitario),
    subtotal: parsearMonto(it?.subtotal),
  })).filter(it => it.descripcion || it.subtotal);
}

function normalizarFactura(raw) {
  const r = raw || {};
  const letra = String(r.letra || '').trim().toUpperCase();
  const categoria = String(r.categoria || '').trim().toLowerCase();
  const metodo = String(r.metodoPago || '').trim().toLowerCase();
  const moneda = /d[oó]lar|usd|u\$s/i.test(String(r.moneda || '')) ? 'Dólares' : 'Pesos';
  const emisor = textoCorto(r.emisor, 80);

  return {
    tipoDocumento: textoCorto(r.tipoDocumento, 30) || 'otro',
    letra: ['A', 'B', 'C'].includes(letra) ? letra : null,
    emisor,
    cuit: normalizarCuit(r.cuit),
    numero: textoCorto(r.numero, 30),
    fechaEmision: parsearFecha(r.fechaEmision),
    fechaVencimiento: parsearFecha(r.fechaVencimiento),
    total: parsearMonto(r.total),
    moneda,
    metodoPago: METODOS_PAGO.includes(metodo) ? metodo : null,
    pagado: typeof r.pagado === 'boolean' ? r.pagado : null,
    rubro: textoCorto(r.rubro, 60),
    descripcion: textoCorto(r.descripcion, 60) || emisor,
    categoria: CATEGORIAS_EGRESO.includes(categoria) ? categoria : 'otro_egreso',
    items: normalizarItems(r.items),
  };
}

function normalizarHora(value) {
  const m = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function normalizarTransferencia(raw) {
  const r = raw || {};
  const dni = String(r.cuitPagador || '').replace(/\D/g, '');
  return {
    pagador: textoCorto(r.pagador, 80),
    cuitPagador: dni.length === 11 ? normalizarCuit(dni) : (dni.length >= 7 ? dni : null),
    destinatario: textoCorto(r.destinatario, 80),
    monto: parsearMonto(r.monto),
    moneda: /d[oó]lar|usd|u\$s/i.test(String(r.moneda || '')) ? 'Dólares' : 'Pesos',
    fecha: parsearFecha(r.fecha),
    hora: normalizarHora(r.hora),
    banco: textoCorto(r.banco, 60),
    numeroOperacion: textoCorto(r.numeroOperacion, 40),
    concepto: textoCorto(r.concepto, 80),
  };
}

function normalizarClasificacion(raw) {
  const tipo = String(raw?.tipo || '').trim().toLowerCase();
  const confianza = Number(raw?.confianza);
  return {
    tipo: TIPOS_DOCUMENTO.includes(tipo) ? tipo : 'otro',
    confianza: Number.isFinite(confianza) ? Math.max(0, Math.min(1, confianza)) : 0,
  };
}

// ── Llamadas a Gemini ────────────────────────────────────────────────────────

// Arma el inlineData para Gemini. Las fotos se reducen (y a color, a
// diferencia de la agenda: en facturas el color ayuda a separar logo/tabla);
// los PDFs van tal cual.
async function prepararParte(buffer, mimeType, anchoMax) {
  if (mimeType === 'application/pdf') {
    return { inlineData: { data: buffer.toString('base64'), mimeType } };
  }
  const sharp = getSharp();
  let data = buffer;
  let mime = mimeType || 'image/jpeg';
  if (sharp) {
    try {
      data = await sharp(buffer)
        .rotate()
        .resize({ width: anchoMax, withoutEnlargement: true, fit: 'inside' })
        .jpeg({ quality: 85 })
        .toBuffer();
      mime = 'image/jpeg';
    } catch (err) {
      console.log(`Comprobantes: preprocess falló, usando original: ${err.message}`);
    }
  }
  return { inlineData: { data: data.toString('base64'), mimeType: mime } };
}

async function llamarGemini(modelos, systemInstruction, parte, instruccion, maxOutputTokens) {
  const ai = getGenAI();
  if (!ai) return { error: 'vision_dependencia_faltante' };

  for (const modelName of [...new Set(modelos.filter(Boolean))]) {
    try {
      const model = ai.getGenerativeModel({
        model: modelName,
        systemInstruction,
        generationConfig: { temperature: 0, maxOutputTokens, responseMimeType: 'application/json' },
      });
      const result = await model.generateContent([parte, instruccion]);
      const parsed = extractJSON(result.response.text().trim());
      if (parsed) return { data: parsed };
    } catch (error) {
      const detalle = error.status ? `[${error.status}] ${error.message}` : error.message;
      console.log(`Comprobantes: modelo ${modelName} no disponible: ${detalle}`);
    }
  }
  return null;
}

async function clasificarDocumento(buffer, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) return { error: 'vision_no_configurada' };
  const parte = await prepararParte(buffer, mimeType, 768);
  const r = await llamarGemini(
    ['gemini-2.5-flash-lite', GEMINI_MODEL, ...FALLBACK_MODELS],
    PROMPT_CLASIFICAR, parte, 'Clasificá este documento. Solo JSON.', 100
  );
  if (!r) return null;
  if (r.error) return r;
  return normalizarClasificacion(r.data);
}

async function extraerFactura(buffer, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) return { error: 'vision_no_configurada' };
  const parte = await prepararParte(buffer, mimeType, 2000);
  const r = await llamarGemini(
    FALLBACK_MODELS, PROMPT_FACTURA, parte,
    'Extraé los datos del comprobante. Solo JSON válido.', 4096
  );
  if (!r) return null;
  if (r.error) return r;
  if (r.data?.error === 'no_es_comprobante') return { error: 'no_es_comprobante' };
  return { factura: normalizarFactura(r.data) };
}

async function extraerTransferencia(buffer, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) return { error: 'vision_no_configurada' };
  const parte = await prepararParte(buffer, mimeType, 1600);
  const r = await llamarGemini(
    FALLBACK_MODELS, PROMPT_TRANSFERENCIA, parte,
    'Extraé los datos de la transferencia. Solo JSON válido.', 1024
  );
  if (!r) return null;
  if (r.error) return r;
  if (r.data?.error === 'no_es_transferencia') return { error: 'no_es_transferencia' };
  return { transferencia: normalizarTransferencia(r.data) };
}

module.exports = {
  clasificarDocumento,
  extraerFactura,
  extraerTransferencia,
  normalizarFactura,
  normalizarTransferencia,
  normalizarClasificacion,
  parsearMonto,
  parsearFecha,
  normalizarCuit,
  CATEGORIAS_EGRESO,
};
