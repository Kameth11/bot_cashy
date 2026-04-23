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

const CLIENTES_FILE = path.join(__dirname, '..', '..', 'clientes.json');

const METODOS_VALIDOS = ['efectivo', 'transferencia', 'tarjeta'];
const COMANDOS_INGRESO = ['consulta', 'servicio'];
const COMANDOS_EGRESO = ['gasto'];

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const CODIGO_EXPIRACION_HORAS = 24;

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
  CLIENTES_FILE,
  METODOS_VALIDOS,
  COMANDOS_INGRESO,
  COMANDOS_EGRESO,
  CODIGO_EXPIRACION_HORAS,
  GEMINI_API_KEY,
  GEMINI_MODEL,
};
