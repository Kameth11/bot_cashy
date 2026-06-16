require('dotenv').config();
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const AUTHORIZED_USER_ID = process.env.AUTHORIZED_USER_ID ? parseInt(process.env.AUTHORIZED_USER_ID, 10) : null;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';
const COTIZACION_DEFAULT = process.env.COTIZACION_DEFAULT ? parseFloat(process.env.COTIZACION_DEFAULT) : null;
const ALLOWED_EMAILS = process.env.ALLOWED_EMAILS ? process.env.ALLOWED_EMAILS.split(',').map(e => e.trim().toLowerCase()) : [];
const MAX_INTENTOS_EMAIL = 3;
const MAX_INTENTOS_CODIGO = 5;
const MAX_TEXT_LENGTH = 1000;
const MAX_DESCRIPCION_LENGTH = 120;
const MAX_MOVIMIENTO_MONTO = 1000000000;
const MAX_COTIZACION_DOLAR = 100000;
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_TURNOS_POR_IMAGEN = 120;
const MAX_VOICE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_VOICE_DURATION_SECONDS = 120;
const RATE_LIMIT_WINDOW_MS = 10 * 1000;
const RATE_LIMIT_MAX_EVENTS = 12;

const CLIENTES_FILE = path.join(__dirname, '..', '..', 'clientes.json');

const METODOS_VALIDOS = ['efectivo', 'transferencia', 'tarjeta'];
const COMANDOS_INGRESO = ['consulta', 'servicio'];
const COMANDOS_EGRESO = ['gasto'];

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const CODIGO_EXPIRACION_HORAS = 24;

// Mapeo de nombre de consultorio → profesional. Clave en minúsculas.
// Valor vacío ('') significa que no se muestra nombre de profesional.
const CONSULTORIO_MAP = {
  'consultorio 1': 'Laura',
  'consultorio 2': 'Diego',
  'consultorio 3': '',
};

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const USE_SUPABASE = process.env.USE_SUPABASE === 'true';

const DASHBOARD_URL = process.env.DASHBOARD_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');

if (!BOT_TOKEN || !SPREADSHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
  console.error('Faltan variables de entorno. Revisa tu archivo .env');
  process.exit(1);
}

module.exports = {
  BOT_TOKEN,
  AUTHORIZED_USER_ID,
  SPREADSHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  COTIZACION_DEFAULT,
  ALLOWED_EMAILS,
  MAX_INTENTOS_EMAIL,
  MAX_INTENTOS_CODIGO,
  MAX_TEXT_LENGTH,
  MAX_DESCRIPCION_LENGTH,
  MAX_MOVIMIENTO_MONTO,
  MAX_COTIZACION_DOLAR,
  MAX_PHOTO_SIZE_BYTES,
  MAX_VOICE_SIZE_BYTES,
  MAX_VOICE_DURATION_SECONDS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_EVENTS,
  CLIENTES_FILE,
  METODOS_VALIDOS,
  COMANDOS_INGRESO,
  COMANDOS_EGRESO,
  MAX_TURNOS_POR_IMAGEN,
  CODIGO_EXPIRACION_HORAS,
  GEMINI_API_KEY,
  GEMINI_MODEL,
  GEMINI_VISION_MODEL,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  USE_SUPABASE,
  DASHBOARD_URL,
  CONSULTORIO_MAP,
};
