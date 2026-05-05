const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');
const { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_VISION_MODEL } = require('../config');

const SYSTEM_PROMPT = `Sos un parser experto en OCR de agendas medicas y odontologicas en Argentina. Tu unica tarea es mirar una foto y devolver JSON puro.

Reglas:
- Priorizá precision por sobre cantidad. Es mejor devolver menos turnos pero correctos.
- La imagen puede tener 1 o varias columnas, varios odontologos, recortes parciales, sombras, desenfoque o escritura regular.
- Lee la imagen de arriba hacia abajo y de izquierda a derecha dentro de cada bloque visible.
- Si hay varios bloques/columnas, no mezcles pacientes de un bloque con horas de otro.
- Extrae todos los turnos legibles visibles en la imagen.
- Cada turno debe incluir siempre estas claves exactas: consultorio, profesional, hora, cliente, servicio, estado.
- Nunca omitas la clave hora. Si no hay horario legible, devolve "hora": null.
- Si una hora o nombre no se lee con confianza, usa null en ese campo en vez de inventarlo.
- Si un nombre esta parcialmente legible, devolve la mejor lectura posible, pero no completes letras inventadas.
- Si no hay fecha visible, asume que es para hoy.
- Capitaliza nombres y servicios.
- No inventes datos que no se vean.
- Normaliza horas a formato HH:MM si es posible. Si no, devuelve el texto horario mas cercano o null.
- Ignora garabatos, lineas, anotaciones marginales y texto irrelevante.
- Si hay varios consultorios, columnas o profesionales, extrae para cada turno a que bloque pertenece.
- Si ves textos como "Consultorio 1", "Consultorio 2", "Diego", "Laura", "Josefina" o similares como encabezados de bloque, usalos para agrupar.
- Para cada turno, informa consultorio y/o profesional si se pueden leer. Si no se ve alguno, usa null.

Formato exacto de salida:
{"turnos":[{"consultorio":"Consultorio 1","profesional":"Diego","hora":"09:00","cliente":"Maria Lopez","servicio":"Corte","estado":"Pendiente"}]}

Si la imagen no es una agenda o no parece un turnero:
{"error":"no_es_agenda"}

Si es agenda pero no se leen turnos:
{"turnos":[]}`;

const FALLBACK_MODELS = [
  GEMINI_VISION_MODEL || GEMINI_MODEL || 'gemini-2.5-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
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

async function preprocessPhoto(photoBuffer) {
  try {
    return await sharp(photoBuffer)
      .rotate()
      .resize({ width: 2200, withoutEnlargement: true, fit: 'inside' })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.1, m1: 0.8, m2: 2.2, x1: 2, y2: 10, y3: 20 })
      .png({ compressionLevel: 7 })
      .toBuffer();
  } catch (error) {
    console.log(`Vision: preprocess fallo, usando original: ${error.message.substring(0, 120)}`);
    return photoBuffer;
  }
}

function normalizarTurnos(turnos) {
  if (!Array.isArray(turnos)) return [];

  return turnos.map(turno => ({
    consultorio: normalizarTexto(turno?.consultorio),
    profesional: normalizarTexto(turno?.profesional),
    hora: normalizarHora(turno?.hora),
    cliente: normalizarTexto(turno?.cliente),
    servicio: normalizarTexto(turno?.servicio),
    estado: normalizarEstado(turno?.estado),
  })).filter(turno => turno.hora || turno.cliente || turno.servicio);
}

function completarTurno(turno) {
  return {
    consultorio: turno?.consultorio ?? null,
    profesional: turno?.profesional ?? null,
    hora: Object.prototype.hasOwnProperty.call(turno || {}, 'hora') ? turno.hora : null,
    cliente: turno?.cliente ?? null,
    servicio: turno?.servicio ?? null,
    estado: turno?.estado ?? null,
  };
}

function normalizarTexto(value) {
  if (value == null) return null;
  const text = String(value)
    .replace(/\s+/g, ' ')
    .trim();

  return text ? text.replace(/\b\w/g, c => c.toUpperCase()) : null;
}

function normalizarHora(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const match = raw.match(/(\d{1,2})(?:[:.]?(\d{2}))?/);
  if (!match) return raw;

  const horas = parseInt(match[1], 10);
  const minutos = match[2] ? parseInt(match[2], 10) : 0;

  if (Number.isNaN(horas) || horas > 23 || Number.isNaN(minutos) || minutos > 59) {
    return raw;
  }

  return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
}

function normalizarEstado(value) {
  if (!value) return 'Pendiente';
  const raw = String(value).trim().toLowerCase();
  if (['confirmado', 'confirmada'].includes(raw)) return 'Confirmado';
  if (['cancelado', 'cancelada'].includes(raw)) return 'Cancelado';
  if (['atendido', 'atendida'].includes(raw)) return 'Atendido';
  return 'Pendiente';
}

async function procesarFotoAgenda(photoBuffer, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) {
    return { error: 'vision_no_configurada' };
  }

  const ai = getGenAI();
  const processedBuffer = await preprocessPhoto(photoBuffer);
  const imagePart = {
    inlineData: {
      data: processedBuffer.toString('base64'),
      mimeType: 'image/png',
    }
  };

  for (const modelName of [...new Set(FALLBACK_MODELS)]) {
    try {
      const model = ai.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: {
          temperature: 0,
          topP: 0.1,
          topK: 1,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
        },
      });
      const result = await model.generateContent([
        imagePart,
        'Analiza la imagen como una agenda/turnero medico u odontologico ya preprocesado para OCR. Extrae solo los turnos visibles con la mayor precision posible. Si dudas de un dato, usa null. Responde solo JSON valido con la clave turnos.'
      ]);
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

      return { turnos: normalizarTurnos(parsed.turnos.map(completarTurno)) };
    } catch (error) {
      console.log(`Vision: modelo ${modelName} no disponible: ${error.message.substring(0, 120)}`);
    }
  }

  return null;
}

module.exports = { procesarFotoAgenda };
