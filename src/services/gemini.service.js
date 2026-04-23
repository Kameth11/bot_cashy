const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_API_KEY, GEMINI_MODEL } = require('../config');

const SYSTEM_PROMPT = `Sos un parser de mensajes para un bot de cashflow de Telegram. Analizá el mensaje del usuario y devolvé SOLO un JSON con el intent y entidades detectadas. No agregues explicaciones ni markdown.

Intents posibles:
- registrar_movimiento: cuando el usuario quiere registrar un ingreso, servicio o gasto
- ver_balance: cuando pregunta por su balance/resumen/caja
- ver_hoy: cuando pregunta por movimientos de hoy
- ver_semana: cuando pregunta por resumen semanal
- ver_mes: cuando pregunta por resumen mensual
- ver_ingresos: cuando quiere listar ingresos
- ver_egresos: cuando quiere listar gastos
- ver_pendientes: cuando pregunta por cobros pendientes o qué falta cobrar
- cobrar_movimiento: cuando quiere marcar algo como cobrado
- editar_movimiento: cuando quiere editar un movimiento
- eliminar_movimiento: cuando quiere borrar/eliminar un movimiento
- ver_dolar: cuando pregunta por la cotización del dólar
- actualizardolar: cuando quiere actualizar la cotización del dólar
- ver_ayuda: cuando pide ayuda o no sabe cómo usar el bot
- listar_movimientos: cuando quiere ver todos los movimientos

Para registrar_movimiento, extraer estas entidades:
- tipo: "ingreso", "servicio" o "gasto" (si no está claro, inferir por contexto)
- descripcion: texto descriptivo breve (nombre de paciente, concepto, etc.)
- monto: número (si no está en el mensaje, poner null)
- moneda: "Pesos" o "Dólares" (si menciona dólares/USD/U$, poner "Dólares"; default "Pesos")
- metodo_pago: "efectivo", "transferencia" o "tarjeta" (si no está, poner null)

Para cobrar/editar/eliminar_movimiento, extraer:
- nombre: texto para buscar el movimiento (poner null si no hay nombre específico)

Ejemplos de entrada y salida:

"cobré 15000 de Juan Perez en efectivo" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Juan Perez","monto":15000,"moneda":"Pesos","metodo_pago":"efectivo"}}
"me pagaron 50000 por transferencia de Garcia" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Garcia","monto":50000,"moneda":"Pesos","metodo_pago":"transferencia"}}
"servicio de endodoncia 50 dólares" -> {"intent":"registrar_movimiento","entities":{"tipo":"servicio","descripcion":"Endodoncia","monto":50,"moneda":"Dólares","metodo_pago":null}}
"gasté 5000 en alquiler" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Alquiler","monto":5000,"moneda":"Pesos","metodo_pago":null}}
"pagué 2000 de insumos con tarjeta" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Insumos","monto":2000,"moneda":"Pesos","metodo_pago":"tarjeta"}}
"un gasto de 3000 para materiales" -> {"intent":"registrar_movimiento","entities":{"tipo":"gasto","descripcion":"Materiales","monto":3000,"moneda":"Pesos","metodo_pago":null}}
"anotame un ingreso de 8000 de Rodriguez transferencia" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"Rodriguez","monto":8000,"moneda":"Pesos","metodo_pago":"transferencia"}}
"consulta López U$100 efectivo" -> {"intent":"registrar_movimiento","entities":{"tipo":"ingreso","descripcion":"López","monto":100,"moneda":"Dólares","metodo_pago":"efectivo"}}
"cuánto tengo?" -> {"intent":"ver_balance","entities":{}}
"balance" -> {"intent":"ver_balance","entities":{}}
"resumen" -> {"intent":"ver_balance","entities":{}}
"qué cobré hoy?" -> {"intent":"ver_hoy","entities":{}}
"movimientos de hoy" -> {"intent":"ver_hoy","entities":{}}
"cómo va la semana?" -> {"intent":"ver_semana","entities":{}}
"balance del mes" -> {"intent":"ver_mes","entities":{}}
"cuánto gané este mes" -> {"intent":"ver_mes","entities":{}}
"mostrar ingresos" -> {"intent":"ver_ingresos","entities":{}}
"lista de cobros" -> {"intent":"ver_ingresos","entities":{}}
"mostrar gastos" -> {"intent":"ver_egresos","entities":{}}
"qué me falta cobrar?" -> {"intent":"ver_pendientes","entities":{}}
"pendientes" -> {"intent":"ver_pendientes","entities":{}}
"ya me pagó Juan" -> {"intent":"cobrar_movimiento","entities":{"nombre":"Juan"}}
"cobrar el pendiente de Garcia" -> {"intent":"cobrar_movimiento","entities":{"nombre":"Garcia"}}
"cambiar monto de Rodríguez" -> {"intent":"editar_movimiento","entities":{"nombre":"Rodríguez"}}
"borrar el gasto de insumos" -> {"intent":"eliminar_movimiento","entities":{"nombre":"insumos"}}
"eliminar movimiento de López" -> {"intent":"eliminar_movimiento","entities":{"nombre":"López"}}
"cuánto está el dólar" -> {"intent":"ver_dolar","entities":{}}
"cotización" -> {"intent":"ver_dolar","entities":{}}
"actualizar cotización" -> {"intent":"actualizardolar","entities":{}}
"ayuda" -> {"intent":"ver_ayuda","entities":{}}
"no sé cómo usar esto" -> {"intent":"ver_ayuda","entities":{}}
"ver todos los movimientos" -> {"intent":"listar_movimientos","entities":{}}

Si el mensaje no coincide con ningún intent financiero (saludos, charla, etc.), devolvé: {"intent":"desconocido","entities":{}}`;

const FALLBACK_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-pro-latest',
];

const MAX_RETRIES = 1;
const RETRY_DELAYS = [3000];
const CACHE_TTL_MS = 60000;
const RATE_LIMIT_COOLDOWN_MS = 65000;

let genAI = null;
let activeModel = null;
let modelTested = false;

const nlpCache = new Map();
let lastRateLimitError = 0;

function getGenAI() {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  }
  return genAI;
}

async function findWorkingModel() {
  if (modelTested && activeModel) {
    return activeModel;
  }

  const preferredModel = GEMINI_MODEL || 'gemini-flash-lite-latest';
  const modelsToTry = [preferredModel, ...FALLBACK_MODELS.filter(m => m !== preferredModel)];

  const ai = getGenAI();

  for (const modelName of modelsToTry) {
    try {
      const model = ai.getGenerativeModel({ model: modelName });
      const result = await model.generateContent('Respondé solo: ok');
      const text = result.response.text();
      if (text) {
        console.log(`NLP: Modelo activo: ${modelName}`);
        activeModel = model;
        modelTested = true;
        return activeModel;
      }
    } catch (error) {
      console.log(`NLP: Modelo ${modelName} no disponible: ${error.message.substring(0, 80)}`);
    }
  }

  modelTested = true;
  console.error('NLP: Ningún modelo de Gemini disponible. NLP desactivado.');
  return null;
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  const model = await findWorkingModel();
  if (!model) {
    return null;
  }

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent(
        `${SYSTEM_PROMPT}\n\nMensaje del usuario: "${text}"`
      );

      const responseText = result.response.text().trim();

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`NLP: respuesta sin JSON (attempt ${attempt + 1})`);
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.intent) {
        console.error(`NLP: respuesta sin intent (attempt ${attempt + 1})`);
        continue;
      }

      console.log(`NLP [${userId}]: "${text}" -> intent: ${parsed.intent}`, parsed.entities || '');
      setCachedResult(userId, text, parsed);
      return parsed;

    } catch (error) {
      lastError = error;

      const is429 = error.message && (
        error.message.includes('429') ||
        error.message.includes('Too Many Requests') ||
        error.message.includes('quota')
      );

      const is404 = error.message && error.message.includes('404');

      if (is429) {
        lastRateLimitError = Date.now();
        modelTested = false;
        console.log(`NLP: Rate limit hit (429), cooldown ${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
        return null;
      }

      if (is404) {
        modelTested = false;
        activeModel = null;
        console.log('NLP: Modelo no encontrado (404), reintentando con otro modelo...');
        const newModel = await findWorkingModel();
        if (newModel) {
          continue;
        }
        return null;
      }

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt] || 3000;
        console.log(`NLP: Error (attempt ${attempt + 1}), retrying in ${delay / 1000}s...`);
        await sleep(delay);
      }
    }
  }

  if (lastError) {
    console.error(`NLP: todos los reintentos fallaron: ${lastError.message}`);
  }

  return null;
}

module.exports = { parseMessage };