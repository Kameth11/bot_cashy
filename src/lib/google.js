const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const {
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
} = require('../config');

const serviceAccountAuth = new JWT({
  email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: GOOGLE_PRIVATE_KEY,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Todos los tenants comparten la misma service account, o sea la misma cuota de
// la Sheets API (~60 req/min por usuario). Sin reintentos, un 429 pasajero
// tiraba la operación (o perdía en silencio el respaldo a Sheets). Se
// reintenta con backoff exponencial + jitter y se respeta Retry-After.
//
// Qué se reintenta: 429 y 503 en cualquier método (Google no procesó el
// pedido, no duplica nada); el resto de los 5xx y los errores de red solo en
// GET, porque reintentar un append que quizás sí se aplicó duplicaría la fila.
const RETRY_DEFAULTS = { maxRetries: 4, baseDelayMs: 1000, maxDelayMs: 20000 };
const NETWORK_ERRORS = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND']);

function esReintentable(error) {
  const method = String(error.config?.method || 'get').toLowerCase();
  const status = error.response?.status;
  if (status === 429 || status === 503) return true;
  if (method !== 'get') return false;
  if (status >= 500) return true;
  return !error.response && NETWORK_ERRORS.has(error.code);
}

function calcularEspera(error, intento, { baseDelayMs, maxDelayMs }) {
  const retryAfter = Number(error.response?.headers?.['retry-after']);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, maxDelayMs);
  const exp = Math.min(baseDelayMs * 2 ** intento, maxDelayMs);
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

function instalarReintentos(axiosInstance, opts = {}) {
  const cfg = { ...RETRY_DEFAULTS, ...opts };
  const sleep = opts.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));

  axiosInstance.interceptors.response.use(undefined, async (error) => {
    const config = error.config;
    if (!config || !esReintentable(error)) throw error;

    config.__reintentos = (config.__reintentos || 0) + 1;
    if (config.__reintentos > cfg.maxRetries) throw error;

    const espera = calcularEspera(error, config.__reintentos - 1, cfg);
    console.warn(`Google API ${error.response?.status || error.code}: reintento ${config.__reintentos}/${cfg.maxRetries} en ${espera}ms`);
    await sleep(espera);
    return axiosInstance.request(config);
  });
  return axiosInstance;
}

// Única forma de instanciar un spreadsheet: con reintentos ya instalados.
function crearDocumento(sheetId) {
  const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
  instalarReintentos(doc.sheetsApi);
  return doc;
}

module.exports = {
  GoogleSpreadsheet,
  serviceAccountAuth,
  crearDocumento,
  instalarReintentos,
  esReintentable,
};
