const { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_VISION_MODEL } = require('../config');
const { SYSTEM_PROMPT, normalizarNlpResult } = require('./nlp-shared');

const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

const CACHE_TTL_MS = 60000;
const RATE_LIMIT_COOLDOWN_MS = 65000;
const SERVICE_ERROR_COOLDOWN_MS = 180000;
const API_TIMEOUT_MS = 8000;
const AUDIO_API_TIMEOUT_MS = 20000;

const AUDIO_TRANSCRIPTION_MODELS = [GEMINI_VISION_MODEL, 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const TRANSCRIPTION_PROMPT = 'Transcribí este audio a texto en español neutro (Argentina). ' +
  'Devolvé ÚNICAMENTE la transcripción del audio, sin comentarios, encabezados ni formato adicional. ' +
  'Si no se entiende nada, devolvé una cadena vacía.';

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
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
}

function getPreferredModelName() {
  const raw = String(GEMINI_MODEL || '').trim();
  if (!raw) return 'gemini-2.5-flash';
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
  if (!cached) return null;
  if (Date.now() - cached.timestamp >= CACHE_TTL_MS) {
    nlpCache.delete(key);
    return null;
  }
  return cached.result;
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

async function parseMessage(userId, text, _retryDepth = 0) {
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
      if (_retryDepth >= 1) {
        console.error('NLP: 404 reiterado tras reintentar modelo, abortando.');
        return null;
      }
      const model = await findWorkingModel();
      if (model) {
        return parseMessage(userId, text, _retryDepth + 1);
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

async function transcribirAudio(buffer, mimeType = 'audio/ogg') {
  if (!GEMINI_API_KEY) return null;

  const ai = getGenAI();
  if (!ai) return null;

  const audioPart = {
    inlineData: {
      data: buffer.toString('base64'),
      mimeType,
    },
  };

  for (const modelName of [...new Set(AUDIO_TRANSCRIPTION_MODELS.filter(Boolean))]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AUDIO_API_TIMEOUT_MS);

    try {
      const model = ai.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1024,
        },
      });
      const result = await model.generateContent([audioPart, TRANSCRIPTION_PROMPT], { signal: controller.signal });
      return result.response.text().trim();
    } catch (error) {
      const reason = error.name === 'AbortError' ? 'timeout' : error.message.substring(0, 120);
      console.log(`NLP: transcripcion de audio con ${modelName} fallo: ${reason}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

// Redacta una respuesta en lenguaje natural a partir de una pregunta libre
// y una lista de turnos ya resuelta (no decide qué datos buscar, sólo los
// narra). Llamada nueva, separada del clasificador de intents: usa su
// propio modelo sin el systemInstruction/JSON mode de createModel(), porque
// acá la salida es texto libre, no el contrato {intent, entities}.
async function generarRespuestaAgenda(pregunta, turnos) {
  const ai = getGenAI();
  if (!ai) return null;

  const modelName = activeModelName || getPreferredModelName();
  const datos = turnos
    .slice()
    .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''))
    .map(t => `${t.hora || '??:??'} — ${t.cliente || 'Sin nombre'}${t.servicio ? ` (${t.servicio})` : ''}${t.profesional ? ` [${t.profesional}]` : ''} — ${t.estado || ''}`)
    .join('\n');

  const prompt = `Datos de turnos (única fuente de verdad, no inventes nada que no esté acá):\n${datos}\n\nPregunta del usuario: "${pregunta}"\n\nRespondé en español argentino, tono directo y cordial. Si hay turnos de más de un profesional distinto en el resultado, agrupá la respuesta por profesional (ej. "Con Laura: ... Con Diego: ...") en vez de mezclarlos en una sola lista corrida — así se distingue claramente de quién es cada paciente. Si solo hay un profesional (o ninguno indicado), respondé en 1-3 frases como antes, sin agrupar. Si la pregunta pide un subconjunto (ej. "a la tarde") interpretalo por horario (mañana: antes de 13:00, tarde: 13:00 en adelante) usando SOLO los datos de arriba.`;

  let model;
  try {
    model = ai.getGenerativeModel({
      model: modelName,
      generationConfig: { maxOutputTokens: 320, temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } },
    });
  } catch (error) {
    console.error('NLP: error creando modelo para respuesta de agenda:', error.message);
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const result = await model.generateContent(prompt, { signal: controller.signal });
    const text = result.response.text();
    return text ? text.trim() : null;
  } catch (error) {
    console.error('NLP: error generando respuesta de agenda:', error.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { parseMessage, initModel, canAttemptRemoteNlp, transcribirAudio, generarRespuestaAgenda };
