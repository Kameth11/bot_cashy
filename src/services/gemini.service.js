const { GEMINI_API_KEY, GEMINI_MODEL } = require('../config');

const SYSTEM_PROMPT = `Eres un parser. Tu UNICA salida es un JSON objeto, sin texto antes o despues.

Intents: registrar_movimiento, ver_balance, ver_hoy, ver_semana, ver_mes, ver_ingresos, ver_egresos, ver_pendientes, cobrar_movimiento, editar_movimiento, eliminar_movimiento, ver_dolar, actualizardolar, ver_ayuda, listar_movimientos, desconocido

registrar_movimiento: tipo("ingreso"/"servicio"/"gasto"), descripcion(string), monto(number|null), moneda("Pesos"/"Dolares"), metodo_pago("efectivo"/"transferencia"/"tarjeta"|null)
cobrar/editar/eliminar_movimiento: nombre(string|null)
Todos los demas intents: entities vacio {}

Ejemplos:
"cobre 15000 de Juan en efectivo" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Juan","monto":15000,"moneda":"Pesos","metodo_pago":"efectivo"}}
"gaste 5000 en alquiler" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Alquiler","monto":5000,"moneda":"Pesos","metodo_pago":null}}
"servicio endodoncia U$50 transferencia" -> {"intent":"registrar_movimiento","entities":{"tipo":"servicio","descripcion":"Endodoncia","monto":50,"moneda":"Dolares","metodo_pago":"transferencia"}}
"cuanto tengo" -> {"intent":"ver_balance","entities":{}}
"ya me pago Juan" -> {"intent":"cobrar_movimiento","entities":{"nombre":"Juan"}}
"borrar gasto insumos" -> {"intent":"eliminar_movimiento","entities":{"nombre":"insumos"}}
"hola" -> {"intent":"desconocido","entities":{}}`;

const FALLBACK_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash-001',
  'gemini-flash-lite-latest',
];

const CACHE_TTL_MS = 60000;
const RATE_LIMIT_COOLDOWN_MS = 65000;
const API_TIMEOUT_MS = 8000;

let genAI = null;
let activeModel = null;
let activeModelName = null;
let modelReady = false;
let GoogleGenerativeAI = null;
let geminiUnavailableLogged = false;

const nlpCache = new Map();
let lastRateLimitError = 0;

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

async function findWorkingModel() {
  const preferredModel = GEMINI_MODEL || 'gemini-flash-lite-latest';
  const modelsToTry = [preferredModel, ...FALLBACK_MODELS.filter(m => m !== preferredModel)];
  const ai = getGenAI();
  if (!ai) {
    modelReady = true;
    return null;
  }

  for (const modelName of modelsToTry) {
    try {
      const model = createModel(ai, modelName);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
      try {
        const result = await model.generateContent('Responde: ok', { signal: controller.signal });
        clearTimeout(timeout);
        const text = result.response.text();
        if (text) {
          console.log(`NLP: Modelo activo: ${modelName}`);
          activeModel = model;
          activeModelName = modelName;
          modelReady = true;
          return activeModel;
        }
      } catch (e) {
        clearTimeout(timeout);
        throw e;
      }
    } catch (error) {
      console.log(`NLP: Modelo ${modelName} no disponible: ${error.message.substring(0, 80)}`);
    }
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

  const preferredModel = GEMINI_MODEL || 'gemini-flash-lite-latest';
  const ai = getGenAI();
  if (!ai) {
    modelReady = true;
    return;
  }
  activeModel = createModel(ai, preferredModel);
  activeModelName = preferredModel;
  modelReady = true;

  console.log(`NLP: Modelo configurado: ${preferredModel}. Validando en background...`);

  findWorkingModel().then(() => {
    console.log(`NLP: Listo. Modelo activo: ${activeModelName}`);
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

async function parseMessage(userId, text) {
  if (!GEMINI_API_KEY) {
    return null;
  }

  if (isRateLimited()) {
    console.log('NLP: Rate limit cooldown activo, saltando...');
    return null;
  }

  const cached = getCachedResult(userId, text);
  if (cached) {
    console.log(`NLP [${userId}]: cache hit for "${text}"`);
    return cached;
  }

  if (!activeModel) {
    const model = await findWorkingModel();
    if (!model) return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    let result;
    try {
      result = await activeModel.generateContent(`Mensaje del usuario: "${text}"`, { signal: controller.signal });
      clearTimeout(timeout);
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        console.error('NLP: Timeout en llamada a Gemini');
        return null;
      }
      throw e;
    }

    modelReady = true;

    const responseText = result.response.text().trim();

    const finishReason = result.response.candidates?.[0]?.finishReason;
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
        console.error('NLP: JSON invalido irrecuperable:', jsonStr.substring(0, 150));
        return null;
      }
    }

    if (!parsed.intent) {
      console.error('NLP: respuesta sin intent');
      return null;
    }

    console.log(`NLP [${userId}]: "${text}" -> intent: ${parsed.intent}`, parsed.entities || '');
    setCachedResult(userId, text, parsed);
    return parsed;

  } catch (error) {
    const is429 = error.message && (
      error.message.includes('429') ||
      error.message.includes('Too Many Requests') ||
      error.message.includes('quota')
    );

    const is404 = error.message && error.message.includes('404');

    if (is429) {
      lastRateLimitError = Date.now();
      modelReady = false;
      activeModel = null;
      console.log(`NLP: Rate limit (429), cooldown ${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
      return null;
    }

    if (is404) {
      modelReady = false;
      activeModel = null;
      console.log('NLP: Modelo no encontrado (404), buscando otro...');
      const model = await findWorkingModel();
      if (model) {
        return parseMessage(userId, text);
      }
      return null;
    }

    console.error(`NLP: Error: ${error.message.substring(0, 120)}`);
    return null;
  }
}

module.exports = { parseMessage, initModel };
