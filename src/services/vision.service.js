const { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_VISION_MODEL } = require('../config');

const SYSTEM_PROMPT = `Sos un parser experto en OCR de agendas medicas y odontologicas en Argentina. Tu unica tarea es mirar una foto y devolver JSON puro.

IMPORTANTE: Las agendas son casi siempre escritas a mano con letra cursiva o de imprenta. Esforzate al maximo para leer escritura manuscrita aunque sea poco clara. Si podés leer una palabra con 70% de confianza, incluila — es mejor que null.

Reglas:
- La imagen puede tener 1 o varias columnas, varios profesionales, recortes parciales, sombras, desenfoque o escritura a mano.
- Lee la imagen de arriba hacia abajo y de izquierda a derecha dentro de cada bloque visible.
- Si hay varios bloques/columnas, no mezcles pacientes de un bloque con horas de otro.
- Extrae todos los turnos visibles, incluso los parcialmente legibles.
- Cada turno debe incluir siempre estas claves exactas: consultorio, profesional, hora, cliente, servicio, estado.
- Nunca omitas la clave hora. Si no hay horario legible, devolve "hora": null.
- Para nombres de pacientes escritos a mano: intentá leer la escritura cursiva o de imprenta. Si estás 70%+ seguro, incluilo. Solo usá null si es completamente ilegible.
- Normaliza horas a formato HH:MM. Si ves "9" interpretalo como "09:00", "9:30" como "09:30", etc.
- Capitaliza nombres y servicios.
- No inventes apellidos ni datos que no se vean, pero sí intentá leer lo que está escrito.
- Ignora garabatos, lineas, anotaciones marginales y texto irrelevante.
- Si hay varios consultorios o profesionales como encabezados de columna, usalos para agrupar cada turno.
- Para cada turno, informa consultorio y/o profesional si se pueden leer. Si no se ve, usa null.
- Si una celda tiene solo un nombre sin servicio, poné el nombre en "cliente" y null en "servicio".
- El campo "consultorio" SIEMPRE debe usar número arábigo: "Consultorio 1", "Consultorio 2", nunca "Consultorio Uno" ni "Consultorio uno".

Formato exacto de salida:
{"turnos":[{"consultorio":"Consultorio 1","profesional":"Diego","hora":"09:00","cliente":"Maria Lopez","servicio":"Limpieza","estado":"Pendiente"}]}

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
let GoogleGenerativeAI = null;
let dependencyChecked = false;
let sharpLib = null;
let sharpChecked = false;

function getFactory() {
  if (dependencyChecked) {
    return GoogleGenerativeAI;
  }

  dependencyChecked = true;

  try {
    ({ GoogleGenerativeAI } = require('@google/generative-ai'));
  } catch (error) {
    GoogleGenerativeAI = null;
    console.error('Vision: falta instalar @google/generative-ai');
  }

  return GoogleGenerativeAI;
}

function getGenAI() {
  const Factory = getFactory();
  if (!Factory) {
    return null;
  }

  if (!genAI) {
    genAI = new Factory(GEMINI_API_KEY);
  }
  return genAI;
}

function getSharp() {
  if (sharpChecked) {
    return sharpLib;
  }

  sharpChecked = true;

  try {
    sharpLib = require('sharp');
  } catch (error) {
    sharpLib = null;
    console.log('Vision: sharp no disponible, usando imagen original');
  }

  return sharpLib;
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
  const sharp = getSharp();
  if (!sharp) {
    return photoBuffer;
  }

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
    console.log(`Vision: preprocess fallo, usando original: ${error.message}`);
    return photoBuffer;
  }
}

function normalizarTurnos(turnos) {
  if (!Array.isArray(turnos)) return [];

  return turnos.map(turno => ({
    consultorio: normalizarConsultorio(turno?.consultorio),
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

const NUMEROS_ESCRITOS = {
  'uno': '1', 'dos': '2', 'tres': '3', 'cuatro': '4', 'cinco': '5',
  'seis': '6', 'siete': '7', 'ocho': '8', 'nueve': '9', 'diez': '10',
};

function normalizarTexto(value) {
  if (value == null) return null;
  const text = String(value)
    .replace(/\s+/g, ' ')
    .trim();

  return text ? text.replace(/\b\w/g, c => c.toUpperCase()) : null;
}

function normalizarConsultorio(value) {
  const texto = normalizarTexto(value);
  if (!texto) return null;
  return texto.replace(/\b(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/gi, w => NUMEROS_ESCRITOS[w.toLowerCase()]);
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
  if (!ai) {
    return { error: 'vision_dependencia_faltante' };
  }
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
      const detalle = error.status ? `[${error.status}] ${error.message}` : error.message;
      console.log(`Vision: modelo ${modelName} no disponible: ${detalle}`);
      if (error.cause) {
        console.log(`Vision: causa subyacente: ${error.cause}`);
      }
    }
  }

  return null;
}

module.exports = { procesarFotoAgenda };
