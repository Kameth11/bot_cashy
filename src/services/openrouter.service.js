const { OPENROUTER_API_KEY, OPENROUTER_MODEL } = require('../config');
const { SYSTEM_PROMPT, normalizarNlpResult } = require('./nlp-shared');

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_TIMEOUT_MS = 12000;

function canAttemptFullIA() {
  return Boolean(OPENROUTER_API_KEY);
}

async function parseMessage(userId, text) {
  if (!OPENROUTER_API_KEY) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Mensaje del usuario: "${text}"` },
        ],
      }),
    });
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'timeout' : error.message.substring(0, 120);
    console.error(`FullIA [${userId}]: fallo de red con OpenRouter: ${reason}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`FullIA [${userId}]: OpenRouter respondió ${response.status}: ${body.substring(0, 150)}`);
    return null;
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    console.error(`FullIA [${userId}]: respuesta de OpenRouter no es JSON válido`);
    return null;
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    console.error(`FullIA [${userId}]: OpenRouter no devolvió contenido`);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    console.error(`FullIA [${userId}]: JSON inválido de OpenRouter: ${content.substring(0, 150)}`);
    return null;
  }

  if (!parsed.intent) {
    console.error(`FullIA [${userId}]: respuesta sin intent`);
    return null;
  }

  const normalized = normalizarNlpResult(parsed);
  if (!normalized) {
    console.error('FullIA: respuesta inválida tras normalización');
    return null;
  }

  console.log(`FullIA [${userId}]: "${text}" -> intent: ${normalized.intent}`, normalized.entities || '');
  return normalized;
}

module.exports = { parseMessage, canAttemptFullIA };
