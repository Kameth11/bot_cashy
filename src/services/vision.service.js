const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_API_KEY, GEMINI_MODEL } = require('../config');

const SYSTEM_PROMPT = `Sos un parser de imagenes de agendas o turneros para un bot argentino. Tu unica tarea es mirar una foto y devolver JSON puro.

Reglas:
- Extrae todos los turnos legibles visibles en la imagen
- Si una parte no se lee bien, usa null
- Si no hay fecha visible, asume que es para hoy
- Capitaliza nombres y servicios
- No inventes datos que no se vean

Formato exacto de salida:
{"turnos":[{"hora":"09:00","cliente":"Maria Lopez","servicio":"Corte","estado":"Pendiente"}]}

Si la imagen no es una agenda o no parece un turnero:
{"error":"no_es_agenda"}

Si es agenda pero no se leen turnos:
{"turnos":[]}`;

const FALLBACK_MODELS = [
  GEMINI_MODEL || 'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash-001',
  'gemini-1.5-flash',
];

let genAI = null;

function getGenAI() {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  }
  return genAI;
}

function extractJSON(text) {
  if (!text) return null;

  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (_) {}
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (_) {}
  }

  return null;
}

function normalizarTurnos(turnos) {
  if (!Array.isArray(turnos)) return [];

  return turnos.map(turno => ({
    hora: turno?.hora || null,
    cliente: turno?.cliente || null,
    servicio: turno?.servicio || null,
    estado: turno?.estado || 'Pendiente',
  })).filter(turno => turno.hora || turno.cliente || turno.servicio);
}

async function procesarFotoAgenda(photoBuffer, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) {
    return { error: 'vision_no_configurada' };
  }

  const ai = getGenAI();
  const imagePart = {
    inlineData: {
      data: photoBuffer.toString('base64'),
      mimeType,
    }
  };

  for (const modelName of [...new Set(FALLBACK_MODELS)]) {
    try {
      const model = ai.getGenerativeModel({ model: modelName, systemInstruction: SYSTEM_PROMPT });
      const result = await model.generateContent([imagePart, 'Extrae los turnos visibles y responde solo JSON.']);
      const text = result.response.text().trim();
      const parsed = extractJSON(text);

      if (!parsed) {
        continue;
      }

      if (parsed.error === 'no_es_agenda') {
        return { error: 'no_es_agenda' };
      }

      if (!Array.isArray(parsed.turnos)) {
        continue;
      }

      return { turnos: normalizarTurnos(parsed.turnos) };
    } catch (error) {
      console.log(`Vision: modelo ${modelName} no disponible: ${error.message.substring(0, 120)}`);
    }
  }

  return null;
}

module.exports = { procesarFotoAgenda };
