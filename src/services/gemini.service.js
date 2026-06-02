const { GEMINI_API_KEY, GEMINI_MODEL } = require('../config');

const SYSTEM_PROMPT = `Eres un parser de mensajes de cashflow de Argentina. Tu UNICA salida es un JSON objeto, sin texto antes o despues.

Intents: registrar_movimiento, ver_balance, ver_hoy, ver_semana, ver_mes, ver_ingresos, ver_egresos, ver_pendientes, cobrar_movimiento, editar_movimiento, eliminar_movimiento, ver_dolar, actualizardolar, ver_ayuda, listar_movimientos, desconocido

registrar_movimiento: tipo("ingreso"/"servicio"/"gasto"), descripcion(string), monto(number|null), moneda("Pesos"/"Dolares"/"Euros"), metodo_pago("efectivo"/"transferencia"/"tarjeta"|null), categoria(string|null), pacienteNombre(string|null), pagadorNombre(string|null), profesionalNombre(string|null), tratamientoNombre(string|null), proveedorNombre(string|null)
cobrar/editar/eliminar_movimiento: nombre(string|null)
Todos los demas intents: entities vacio {}

Interpretacion:
- Entiende frases coloquiales argentinas como "guita", "plata", "mangos", "lucas", "15k", "15 mil", "2 palos".
- Si detectas ingreso o gasto pero falta monto o descripcion, igual usa intent "registrar_movimiento" y pone el campo faltante en null.
- "entro", "entraron", "me entro", "me entraron" suelen indicar ingreso.
- "salio", "salieron", "se fue", "se me fue" suelen indicar gasto.
- Si dice "consulta" o "servicio", consideralo ingreso.
- Si menciona mercadopago o mp, usar metodo_pago "transferencia".
- Monedas: $ o pesos → "Pesos"; U$, USD, dólares → "Dolares"; €, EUR, euros → "Euros".
- Si puedes inferir categoria, usa una de estas: consulta, tratamiento, anticipo, sena, cuota, saldo_final, cobro_pendiente, sueldos, honorarios, insumos, alquiler, expensas, servicios, impuestos, mantenimiento, software, otro_ingreso, otro_egreso.
- Si puedes separar entidades, usa estos campos:
  - pacienteNombre: para pacientes
  - pagadorNombre: para quien efectivamente pagó en ingresos cuando se pueda inferir
  - profesionalNombre: para doctores o profesionales
  - tratamientoNombre: para implante, ortodoncia, limpieza, etc
  - proveedorNombre: para proveedores en egresos
- Si el mensaje dice "le pagaron a/alguien" o "le transfirieron a/alguien" en el contexto de un paciente pagando al consultorio, interpretalo como ingreso.
- Si el mensaje dice "le pagamos a [proveedor/servicio]" o "pagamos al [gasista/plomero/electricista/etc]", interpretalo como gasto (egreso). Palabras clave de gasto: gasista, plomero, electricista, albañil, proveedor, taller, técnico, empresa de servicios.
- Si el mensaje sigue la forma "X le pagó a Y ... por una consulta/servicio/tratamiento", toma a X como paciente y pagador, y a Y como profesional o receptor del cobro.
- Si la categoria es "consulta" y no hay un tratamiento más específico, usa tratamientoNombre "Consulta".
- Si aparece una frase como "Diego vino por consulta" o "Vino Diego por limpieza", toma a Diego como pacienteNombre.
- No uses profesionalNombre para un nombre comun salvo que aparezca un titulo explicito como Dr, Dra, doctor o doctora.
- Si el usuario dice que alguien "ya pagó", "me pagó", "me transfirió", "entró lo de" o "cobré lo de", normalmente es cobrar_movimiento cuando se refiere a una deuda pendiente existente.
- Si la frase describe plata que entra o sale como un hecho nuevo para registrar, usar registrar_movimiento.
- Para cobrar_movimiento, extrae el nombre/persona/concepto en nombre.

Ejemplos:
"cobre 15000 de Juan en efectivo" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Juan","monto":15000,"moneda":"Pesos","metodo_pago":"efectivo","categoria":"tratamiento","pacienteNombre":"Juan","pagadorNombre":"Juan","profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null}}
"gaste 5000 en alquiler" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Alquiler","monto":5000,"moneda":"Pesos","metodo_pago":null,"categoria":"alquiler","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null}}
"servicio endodoncia U$50 transferencia" -> {"intent":"registrar_movimiento","entities":{"tipo":"servicio","descripcion":"Endodoncia","monto":50,"moneda":"Dolares","metodo_pago":"transferencia","categoria":"tratamiento","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":"Endodoncia","proveedorNombre":null}}
"anticipo Juan Perez implante Dra Lopez 50k transferencia" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Juan Perez","monto":50000,"moneda":"Pesos","metodo_pago":"transferencia","categoria":"anticipo","pacienteNombre":"Juan Perez","pagadorNombre":null,"profesionalNombre":"Dra Lopez","tratamientoNombre":"Implante","proveedorNombre":null}}
"pague a Dental Sur 80k por guantes" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Guantes","monto":80000,"moneda":"Pesos","metodo_pago":null,"categoria":"insumos","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":"Dental Sur"}}
"me pagó Juan" -> {"intent":"cobrar_movimiento","entities":{"nombre":"Juan"}}
"ya entró lo de Marta" -> {"intent":"cobrar_movimiento","entities":{"nombre":"Marta"}}
"Juan me transfirió" -> {"intent":"cobrar_movimiento","entities":{"nombre":"Juan"}}
"le pagaron a Diego 400mil pesos en efectivo" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Diego","monto":400000,"moneda":"Pesos","metodo_pago":"efectivo","categoria":"tratamiento","pacienteNombre":"Diego","pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null}}
"le pagamos al gasista 400 dolares en transferencia" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Gasista","monto":400,"moneda":"Dolares","metodo_pago":"transferencia","categoria":"servicios","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":"Gasista"}}
"le pagaron a Laura de DientesFacil 400mil pesos" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Laura","monto":400000,"moneda":"Pesos","metodo_pago":null,"categoria":"tratamiento","pacienteNombre":"Laura","pagadorNombre":"DientesFacil","profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null}}
"Laura Santillan le pagó a Diego 500000 pesos en efectivo por una consulta" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Laura Santillan","monto":500000,"moneda":"Pesos","metodo_pago":"efectivo","categoria":"consulta","pacienteNombre":"Laura Santillan","pagadorNombre":"Laura Santillan","profesionalNombre":"Diego","tratamientoNombre":"Consulta","proveedorNombre":null}}
"Diego vino por consulta" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Diego","monto":null,"moneda":"Pesos","metodo_pago":null,"categoria":"consulta","pacienteNombre":"Diego","pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":"Consulta","proveedorNombre":null}}
"cuanto tengo" -> {"intent":"ver_balance","entities":{}}
"ya me pago Juan" -> {"intent":"cobrar_movimiento","entities":{"nombre":"Juan"}}
"borrar gasto insumos" -> {"intent":"eliminar_movimiento","entities":{"nombre":"insumos"}}
"honorarios €200 transferencia" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Honorarios","monto":200,"moneda":"Euros","metodo_pago":"transferencia","categoria":"honorarios","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null}}
"insumos €50 efectivo" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Insumos","monto":50,"moneda":"Euros","metodo_pago":"efectivo","categoria":"insumos","pacienteNombre":null,"pagadorNombre":null,"profesionalNombre":null,"tratamientoNombre":null,"proveedorNombre":null}}
"hola" -> {"intent":"desconocido","entities":{}}`;

const FALLBACK_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite-001',
  'gemini-flash-lite-latest',
];

const CACHE_TTL_MS = 60000;
const RATE_LIMIT_COOLDOWN_MS = 65000;
const SERVICE_ERROR_COOLDOWN_MS = 180000;
const API_TIMEOUT_MS = 8000;

let genAI = null;
let activeModel = null;
let activeModelName = null;
let modelReady = false;
let GoogleGenerativeAI = null;
let geminiUnavailableLogged = false;

const nlpCache = new Map();
let lastRateLimitError = 0;
let lastServiceError = 0;

function getGenAI() {
  if (!GoogleGenerativeAI) {
    try {
      ({ GoogleGenerativeAI } = require('@google/generative-ai'));
    } catch (error) {
      if (!geminiUnavailableLogged) {
        console.error('NLP: falta instalar @google/generative-ai, NLP desactivado');
        geminiUnavailableLogged = true;
      }
      return null;
    }
  }

  if (!genAI) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  }
  return genAI;
}

function createModel(ai, modelName) {
  return ai.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      maxOutputTokens: 512,
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });
}

function getPreferredModelName() {
  const raw = String(GEMINI_MODEL || '').trim();
  if (!raw) return 'gemini-2.5-flash-lite';
  return raw;
}

function getModelCandidates(preferredModel = getPreferredModelName()) {
  return [...new Set([
    activeModelName,
    preferredModel,
    ...FALLBACK_MODELS,
  ].filter(Boolean))];
}

function isRateLimitError(error) {
  return Boolean(error && error.message && (
    error.message.includes('429') ||
    error.message.includes('Too Many Requests') ||
    error.message.includes('quota')
  ));
}

function isNotFoundError(error) {
  return Boolean(error && error.message && error.message.includes('404'));
}

function isRetryableServiceError(error) {
  return Boolean(error && error.message && (
    error.message.includes('503') ||
    error.message.includes('500') ||
    error.message.includes('502') ||
    error.message.includes('504') ||
    error.message.includes('overloaded') ||
    error.message.includes('high demand') ||
    error.message.includes('Service Unavailable')
  ));
}

async function generateWithModel(model, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    return await model.generateContent(prompt, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function tryModel(modelName, prompt) {
  const ai = getGenAI();
  if (!ai) return { ok: false, error: new Error('gemini_unavailable') };

  try {
    const model = createModel(ai, modelName);
    const result = await generateWithModel(model, prompt);
    const text = result.response.text();
    if (!text) {
      return { ok: false, error: new Error(`empty_response:${modelName}`) };
    }

    activeModel = model;
    activeModelName = modelName;
    modelReady = true;
    return { ok: true, result, modelName };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { ok: false, error: new Error(`timeout:${modelName}`) };
    }
    return { ok: false, error };
  }
}

async function findWorkingModel() {
  const preferredModel = getPreferredModelName();
  const modelsToTry = getModelCandidates(preferredModel);
  const ai = getGenAI();
  if (!ai) {
    modelReady = true;
    return null;
  }

  for (const modelName of modelsToTry) {
    const attempt = await tryModel(modelName, 'Responde solo: ok');
    if (attempt.ok) {
      console.log(`NLP: Modelo activo: ${modelName}`);
      return activeModel;
    }

    console.log(`NLP: Modelo ${modelName} no disponible: ${attempt.error.message.substring(0, 80)}`);
  }

  modelReady = true;
  console.error('NLP: Ningún modelo de Gemini disponible. NLP desactivado.');
  return null;
}

function initModel() {
  if (!GEMINI_API_KEY) {
    console.log('NLP: GEMINI_API_KEY no configurada, NLP desactivado');
    modelReady = true;
    return;
  }

  const ai = getGenAI();
  if (!ai) {
    modelReady = true;
    return;
  }
  activeModel = null;
  activeModelName = null;
  modelReady = false;

  console.log(`NLP: Buscando modelo Gemini disponible. Preferido: ${getPreferredModelName()}`);

  findWorkingModel().then(() => {
    if (activeModelName) {
      console.log(`NLP: Listo. Modelo activo: ${activeModelName}`);
    }
  }).catch(() => {});
}

function getCachedResult(userId, text) {
  const key = `${userId}:${text.toLowerCase().trim()}`;
  const cached = nlpCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }
  return null;
}

function setCachedResult(userId, text, result) {
  const key = `${userId}:${text.toLowerCase().trim()}`;
  nlpCache.set(key, { result, timestamp: Date.now() });
}

function isRateLimited() {
  return Date.now() - lastRateLimitError < RATE_LIMIT_COOLDOWN_MS;
}

function isServiceUnavailable() {
  return Date.now() - lastServiceError < SERVICE_ERROR_COOLDOWN_MS;
}

function canAttemptRemoteNlp() {
  return Boolean(GEMINI_API_KEY) && !isRateLimited() && !isServiceUnavailable();
}

function repairJSON(str) {
  try { return JSON.parse(str), str; } catch (_) {}

  for (let depth = 0; depth <= 2; depth++) {
    const suffix = '}'.repeat(depth + 1);
    try { return JSON.parse(str + suffix), str + suffix; } catch (_) {}
  }

  const strVals = str.match(/"[^"]*"\s*:\s*"[^"]*"/g);
  if (strVals && strVals.length > 0) {
    const lastComplete = strVals[strVals.length - 1];
    const cutIdx = str.indexOf(lastComplete) + lastComplete.length;
    for (let depth = 0; depth <= 2; depth++) {
      const candidate = str.substring(0, cutIdx) + '}'.repeat(depth + 1);
      try { return JSON.parse(candidate), candidate; } catch (_) {}
    }
  }

  const numVals = str.match(/"[^"]*"\s*:\s*\d+/g);
  if (numVals && numVals.length > 0) {
    const lastComplete = numVals[numVals.length - 1];
    const cutIdx = str.indexOf(lastComplete) + lastComplete.length;
    for (let depth = 0; depth <= 2; depth++) {
      const candidate = str.substring(0, cutIdx) + '}'.repeat(depth + 1);
      try { return JSON.parse(candidate), candidate; } catch (_) {}
    }
  }

  const nullVals = str.match(/"[^"]*"\s*:\s*null/g);
  if (nullVals && nullVals.length > 0) {
    const lastComplete = nullVals[nullVals.length - 1];
    const cutIdx = str.indexOf(lastComplete) + lastComplete.length;
    for (let depth = 0; depth <= 2; depth++) {
      const candidate = str.substring(0, cutIdx) + '}'.repeat(depth + 1);
      try { return JSON.parse(candidate), candidate; } catch (_) {}
    }
  }

  return null;
}

function normalizarMetodoPago(metodo) {
  if (!metodo) return null;
  const raw = String(metodo).trim().toLowerCase();
  if (['efectivo', 'contado', 'cash'].includes(raw)) return 'efectivo';
  if (['transferencia', 'transfer', 'transf', 'tbu', 'cbu', 'mp', 'mercadopago', 'mercado pago'].includes(raw)) return 'transferencia';
  if (['tarjeta', 'debito', 'débito', 'credito', 'crédito', 'visa', 'master', 'mastercard'].includes(raw)) return 'tarjeta';
  return null;
}

function normalizarMoneda(moneda) {
  if (!moneda) return 'Pesos';
  const raw = String(moneda).trim().toLowerCase();
  if (['dolares', 'dólares', 'dolar', 'dólar', 'usd', 'u$s', 'us$'].includes(raw)) return 'Dólares';
  if (['euros', 'euro', 'eur', '€'].includes(raw)) return 'Euros';
  return 'Pesos';
}

function normalizarTipo(tipo) {
  if (!tipo) return null;
  const raw = String(tipo).trim().toLowerCase();
  if (['ingreso', 'consulta', 'servicio'].includes(raw)) return raw === 'ingreso' ? 'ingreso' : raw;
  if (['gasto', 'egreso'].includes(raw)) return 'gasto';
  if (['entro', 'entraron', 'entrada'].includes(raw)) return 'ingreso';
  if (['salio', 'salieron', 'salida'].includes(raw)) return 'gasto';
  return null;
}

function normalizarDescripcion(descripcion) {
  if (descripcion == null) return null;
  const text = String(descripcion).trim();
  return text.length ? text : null;
}

function normalizarEntidadNombre(value) {
  if (value == null) return null;
  const text = String(value)
    .trim()
    .replace(/^(?:de|del|a|al|con|por|para|paciente|proveedor)\s+/i, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
  return text.length ? text : null;
}

function normalizarNombre(nombre) {
  if (nombre == null) return null;
  let text = String(nombre).trim();
  if (!text) return null;

  text = text
    .replace(/^(?:de|del|lo de|la de)\s+/i, '')
    .replace(/^(?:ya\s+)?(?:me\s+)?(?:pago|pag[oó]|transfirio|transfirió|deposito|depositó|entro|entró|cobre|cobré)\s+/i, '')
    .replace(/\s+(?:en efectivo|por transferencia|con transferencia|por mp|por mercadopago|por mercado pago|con tarjeta)$/i, '')
    .trim();

  return text || null;
}

function normalizarCategoria(categoria) {
  if (categoria == null) return null;
  const text = String(categoria)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');

  const allowed = new Set([
    'consulta',
    'tratamiento',
    'anticipo',
    'sena',
    'cuota',
    'saldo_final',
    'cobro_pendiente',
    'sueldos',
    'honorarios',
    'insumos',
    'alquiler',
    'expensas',
    'servicios',
    'impuestos',
    'mantenimiento',
    'software',
    'otro_ingreso',
    'otro_egreso',
  ]);

  return allowed.has(text) ? text : null;
}

function normalizarNlpResult(parsed) {
  if (!parsed || typeof parsed !== 'object' || !parsed.intent) {
    return null;
  }

  const normalized = {
    intent: String(parsed.intent).trim(),
    entities: parsed.entities && typeof parsed.entities === 'object' ? { ...parsed.entities } : {},
  };

  if (normalized.intent === 'registrar_movimiento') {
    normalized.entities.tipo = normalizarTipo(normalized.entities.tipo) || 'ingreso';
    normalized.entities.descripcion = normalizarDescripcion(normalized.entities.descripcion);
    normalized.entities.moneda = normalizarMoneda(normalized.entities.moneda);
    normalized.entities.metodo_pago = normalizarMetodoPago(normalized.entities.metodo_pago);
    normalized.entities.categoria = normalizarCategoria(normalized.entities.categoria);
    normalized.entities.pacienteNombre = normalizarEntidadNombre(normalized.entities.pacienteNombre);
    normalized.entities.pagadorNombre = normalizarEntidadNombre(normalized.entities.pagadorNombre);
    normalized.entities.profesionalNombre = normalizarEntidadNombre(normalized.entities.profesionalNombre);
    normalized.entities.tratamientoNombre = normalizarEntidadNombre(normalized.entities.tratamientoNombre);
    normalized.entities.proveedorNombre = normalizarEntidadNombre(normalized.entities.proveedorNombre);

    if ((normalized.entities.categoria === 'consulta' || normalized.entities.tipo === 'consulta') && !normalized.entities.tratamientoNombre) {
      normalized.entities.tratamientoNombre = 'Consulta';
    }

    if (normalized.entities.monto !== null && normalized.entities.monto !== undefined) {
      const monto = parseFloat(String(normalized.entities.monto).replace(',', '.'));
      normalized.entities.monto = Number.isFinite(monto) && monto > 0 ? monto : null;
    } else {
      normalized.entities.monto = null;
    }
  }

  if (['cobrar_movimiento', 'editar_movimiento', 'eliminar_movimiento'].includes(normalized.intent)) {
    normalized.entities.nombre = normalizarNombre(normalized.entities.nombre);
  }

  return normalized;
}

async function parseMessage(userId, text) {
  if (!GEMINI_API_KEY) {
    return null;
  }

  if (isRateLimited()) {
    console.log('NLP: Rate limit cooldown activo, saltando...');
    return null;
  }

  if (isServiceUnavailable()) {
    return null;
  }

  const cached = getCachedResult(userId, text);
  if (cached) {
    console.log(`NLP [${userId}]: cache hit for "${text}"`);
    return cached;
  }

  const prompt = `Mensaje del usuario: "${text}"`;
  const modelCandidates = getModelCandidates();
  let responseText = null;
  let response = null;
  let lastError = null;
  let sawRateLimit = false;
  let sawRetryableServiceError = false;

  for (const modelName of modelCandidates) {
    const attempt = await tryModel(modelName, prompt);
    if (!attempt.ok) {
      lastError = attempt.error;
      sawRateLimit = sawRateLimit || isRateLimitError(attempt.error);
      sawRetryableServiceError = sawRetryableServiceError || isRetryableServiceError(attempt.error) || String(attempt.error.message || '').startsWith('timeout:');
      console.log(`NLP: fallo runtime con ${modelName}: ${attempt.error.message.substring(0, 120)}`);
      continue;
    }

    response = attempt.result.response;
    responseText = response.text().trim();
    modelReady = true;
    break;
  }

  try {
    if (!responseText) {
      if (sawRateLimit) {
        lastRateLimitError = Date.now();
        console.log(`NLP: Rate limit (429), cooldown ${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
      } else if (sawRetryableServiceError) {
        lastServiceError = Date.now();
        console.log(`NLP: Servicios Gemini inestables, cooldown ${SERVICE_ERROR_COOLDOWN_MS / 1000}s`);
      }

      if (lastError) {
        console.error(`NLP: sin respuesta usable de Gemini: ${String(lastError.message || '').substring(0, 120)}`);
      }
      return null;
    }

    if (!activeModelName) {
      console.log('NLP: Gemini respondió sin fijar modelo activo');
    }

    const finishReason = response?.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.warn(`NLP: finishReason=${finishReason}`);
    }

    let jsonStr = null;

    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
    }

    if (!jsonStr) {
      const openBrace = responseText.indexOf('{');
      if (openBrace !== -1) {
        jsonStr = responseText.substring(openBrace);
      }
    }

    if (!jsonStr) {
      console.error('NLP: sin JSON en respuesta:', responseText.substring(0, 150));
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      const repaired = repairJSON(jsonStr);
      if (repaired) {
        console.log('NLP: JSON reparado exitosamente');
        parsed = JSON.parse(repaired);
      } else {
        console.error(`NLP [${userId}]: JSON invalido irrecuperable. Texto usuario: "${text.substring(0, 80)}"`);
        console.error(`NLP [${userId}]: Respuesta cruda (${responseText.length}b):`, responseText.substring(0, 200));
        return null;
      }
    }

    if (!parsed.intent) {
      console.error(`NLP [${userId}]: respuesta sin intent. Texto usuario: "${text.substring(0, 80)}"`);
      return null;
    }

    const normalized = normalizarNlpResult(parsed);
    if (!normalized) {
      console.error('NLP: respuesta invalida tras normalizacion');
      return null;
    }

    console.log(`NLP [${userId}]: "${text}" -> intent: ${normalized.intent}`, normalized.entities || '');
    setCachedResult(userId, text, normalized);
    return normalized;

  } catch (error) {
    if (isRateLimitError(error)) {
      lastRateLimitError = Date.now();
      modelReady = false;
      activeModel = null;
      activeModelName = null;
      console.log(`NLP: Rate limit (429), cooldown ${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
      return null;
    }

    if (isNotFoundError(error)) {
      modelReady = false;
      activeModel = null;
      activeModelName = null;
      console.log('NLP: Modelo no encontrado (404), buscando otro...');
      const model = await findWorkingModel();
      if (model) {
        return parseMessage(userId, text);
      }
      return null;
    }

    if (isRetryableServiceError(error) || error.name === 'AbortError') {
      lastServiceError = Date.now();
    }
    console.error(`NLP: Error: ${error.message.substring(0, 120)}`);
    return null;
  }
}

const MOVIMIENTO_PROMPT = `Sos el asistente de cashflow de un consultorio odontológico argentino.
Extraé los datos del movimiento del texto del usuario.

MONEDAS SOPORTADAS:
- "Pesos" → símbolo $ o sin símbolo, o palabras "pesos"
- "Dólares" → símbolo U$, USD, u$s, dólares, "dolar"
- "Euros" → símbolo €, EUR, euros, "euro"

ENTIDADES A EXTRAER:
- tipo: "Ingreso" o "Egreso"
- estado: "Cobrado" o "Pendiente"
- monto: número positivo (el tipo define si es ingreso o egreso)
- moneda: "Pesos", "Dólares" o "Euros"
- metodo_pago: "efectivo", "transferencia", "tarjeta" o null
- categoria: null si no está claro
- pacienteNombre: null si no se menciona
- profesionalNombre: null si no se menciona
- tratamientoNombre: null si no se menciona
- proveedorNombre: null si no se menciona (solo para egresos)

IMPORTANTE: Respondé SOLO con JSON válido, sin texto adicional, sin markdown.
Si no podés extraer tipo ni monto, devolvé: {"error":"no_entendido"}`;

function normalizarEntidadesMovimiento(raw) {
  if (!raw || raw.error) return null;

  const tipo = (() => {
    const t = String(raw.tipo || '').trim().toLowerCase();
    if (['egreso', 'gasto'].includes(t)) return 'gasto';
    if (['ingreso', 'servicio', 'consulta'].includes(t)) return t === 'ingreso' ? 'ingreso' : t;
    return null;
  })();

  const monto = (() => {
    const v = parseFloat(String(raw.monto || '').replace(',', '.'));
    return Number.isFinite(v) && v > 0 ? v : null;
  })();

  if (!tipo || !monto) {
    console.error(`NLP-mov: resultado incompleto descartado — tipo:${raw.tipo} monto:${raw.monto}`);
    return null;
  }

  return {
    intent: 'registrar_movimiento',
    entities: {
      tipo,
      estado: raw.estado === 'Pendiente' ? 'Pendiente' : 'Cobrado',
      monto,
      moneda: normalizarMoneda(raw.moneda),
      metodo_pago: normalizarMetodoPago(raw.metodo_pago),
      categoria: normalizarCategoria(raw.categoria),
      pacienteNombre: normalizarEntidadNombre(raw.pacienteNombre),
      profesionalNombre: normalizarEntidadNombre(raw.profesionalNombre),
      tratamientoNombre: normalizarEntidadNombre(raw.tratamientoNombre),
      proveedorNombre: normalizarEntidadNombre(raw.proveedorNombre),
    },
  };
}

async function parseMovimientoEntidades(userId, text) {
  if (!canAttemptRemoteNlp()) return null;

  const cacheKey = `mov:${userId}:${text.toLowerCase().trim()}`;
  const cached = nlpCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.result;

  const ai = getGenAI();
  if (!ai) return null;

  const modelName = activeModelName || getPreferredModelName();
  let responseText = null;

  try {
    const model = ai.getGenerativeModel({
      model: modelName,
      systemInstruction: MOVIMIENTO_PROMPT,
      generationConfig: { maxOutputTokens: 256, temperature: 0.1, responseMimeType: 'application/json' },
    });
    const result = await generateWithModel(model, `Mensaje: "${text}"`);
    responseText = result.response.text().trim();
  } catch (err) {
    if (isRateLimitError(err)) lastRateLimitError = Date.now();
    return null;
  }

  if (!responseText) return null;

  let parsed;
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      const repaired = repairJSON(jsonStr);
      if (repaired) {
        parsed = JSON.parse(repaired);
      } else {
        console.error(`NLP-mov [${userId}]: JSON invalido. Texto: "${text.substring(0, 80)}"`);
        console.error(`NLP-mov [${userId}]: Respuesta cruda:`, responseText.substring(0, 200));
        return null;
      }
    }
  } catch {
    return null;
  }

  if (parsed.error) return null;

  const normalized = normalizarEntidadesMovimiento(parsed);
  if (normalized) {
    nlpCache.set(cacheKey, { result: normalized, timestamp: Date.now() });
    console.log(`NLP-mov [${userId}]: "${text}" -> tipo:${normalized.entities.tipo} monto:${normalized.entities.monto} moneda:${normalized.entities.moneda}`);
  }
  return normalized;
}

module.exports = { parseMessage, parseMovimientoEntidades, initModel, canAttemptRemoteNlp };
