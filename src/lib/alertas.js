// Avisa al admin (por Discord o por Telegram) cuando la app registra un `logger.error`.
//
// Railway no tiene alertas sobre el contenido de los logs, y un error de código o de configuración
// (como una tabla sin registrar) puede dejar una función rota durante horas sin que nadie lo vea.
// `logger.error` está reservado para cosas que hay que arreglar (ver lib/errores.js), así que cada
// uno merece un aviso; lo transitorio va a `warn` y no avisa.
//
// Para no inundar:
//   - el MISMO error (scope + mensaje) avisa como mucho una vez cada 15 minutos; el aviso siguiente
//     dice cuántas veces se repitió mientras tanto;
//   - tope global de 8 avisos por hora; lo que queda afuera se cuenta y se informa en el próximo.
//
// Destino (Railway → Variables):
//   - ALERTAS_DISCORD_WEBHOOK_URL: si está, los avisos van a ese canal de Discord (webhook entrante).
//     La URL es un secreto (quien la tenga puede escribir en el canal): nunca se loguea.
//   - si no está: Telegram, a ALERTAS_CHAT_ID (default AUTHORIZED_USER_ID; puede ser un grupo).
//   - ALERTAS_ERRORES=off apaga todo. Si el proceso se cae del todo no puede avisar: para eso sirven los webhooks de
// deploys fallidos de Railway (Settings → Webhooks).

const logger = require('./logger');

const VENTANA_MISMO_ERROR_MS = 15 * 60 * 1000;
const HORA_MS = 60 * 60 * 1000;
const MAX_AVISOS_POR_HORA = 8;
const MAX_CLAVES = 200;
const SCOPES_IGNORADOS = new Set(['ALERTAS']);

// Un mensaje de error puede traer tokens o claves largas: no se mandan a un chat.
const SECRETO = /[A-Za-z0-9_\-+/=]{32,}/g;
const limpiar = (valor, max) => String(valor == null ? '' : valor).replace(SECRETO, '[…]').slice(0, max);

function armarTexto(scope, mensaje, meta, repeticiones, omitidas) {
  const lineas = ['🚨 Error en Cashy', `[${limpiar(scope, 40)}] ${limpiar(mensaje, 200)}`];
  const detalle = [];
  if (meta && meta.err) detalle.push(`err: ${limpiar(meta.err, 250)}`);
  if (meta && meta.codigo) detalle.push(`código: ${limpiar(meta.codigo, 30)}`);
  if (meta && meta.status) detalle.push(`status: ${limpiar(meta.status, 10)}`);
  if (detalle.length) lineas.push(detalle.join(' · '));
  if (repeticiones > 0) lineas.push(`Se repitió ${repeticiones} ${repeticiones === 1 ? 'vez' : 'veces'} desde el aviso anterior.`);
  if (omitidas > 0) lineas.push(`(Se omitieron ${omitidas} avisos más por exceso. Revisá los logs de Railway.)`);
  return lineas.join('\n');
}

// `enviar(texto)` y `ahora()` se inyectan para poder probarlo sin Telegram ni relojes.
function crearAlertas({ enviar, ahora = Date.now }) {
  const porClave = new Map(); // scope|mensaje -> { ultimo, suprimidos }
  let avisosRecientes = [];
  let omitidas = 0;

  // Devuelve true si mandó un aviso.
  return function alError(scope, mensaje, meta) {
    if (SCOPES_IGNORADOS.has(scope)) return false;
    const t = ahora();
    const clave = `${scope}|${mensaje}`;
    const entrada = porClave.get(clave) || { ultimo: -Infinity, suprimidos: 0 };

    if (t - entrada.ultimo < VENTANA_MISMO_ERROR_MS) {
      entrada.suprimidos += 1;
      porClave.set(clave, entrada);
      return false;
    }

    avisosRecientes = avisosRecientes.filter(x => t - x < HORA_MS);
    if (avisosRecientes.length >= MAX_AVISOS_POR_HORA) {
      omitidas += 1;
      return false; // sin tocar `ultimo`: si sigue pasando, lo reintenta cuando haya cupo
    }

    avisosRecientes.push(t);
    const texto = armarTexto(scope, mensaje, meta, entrada.suprimidos, omitidas);
    omitidas = 0;
    entrada.ultimo = t;
    entrada.suprimidos = 0;
    porClave.set(clave, entrada);
    if (porClave.size > MAX_CLAVES) porClave.delete(porClave.keys().next().value);

    try { enviar(texto); } catch (err) { logger.warn('ALERTAS', 'No se pudo enviar el aviso', { err: err.message }); }
    return true;
  };
}

// Solo se acepta un webhook de Discord de verdad: evita que un valor mal pegado (o malicioso) haga que
// el servidor mande los errores a cualquier otro lado.
const WEBHOOK_DISCORD = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+\/?$/;
const esWebhookDiscord = (url) => WEBHOOK_DISCORD.test(String(url || '').trim());

// `post(url, cuerpo)` se inyecta (axios.post en producción). Discord corta el contenido en 2000 caracteres.
function crearEnvioDiscord(url, post) {
  return (texto) => {
    // allowed_mentions vacío: un mensaje de error que contenga @everyone o @alguien no menciona a nadie.
    Promise.resolve(post(url, { content: String(texto).slice(0, 1900), allowed_mentions: { parse: [] } }))
      // Solo el mensaje: el error de axios trae la URL (con el token del webhook) en config.url.
      .catch(e => logger.warn('ALERTAS', 'No se pudo enviar el aviso a Discord', { err: e && e.response ? `HTTP ${e.response.status}` : String((e && e.message) || e).slice(0, 100) }));
  };
}

let iniciado = false;
function iniciarAlertas() {
  if (iniciado) return true;
  if (String(process.env.ALERTAS_ERRORES || '').toLowerCase() === 'off') return false;

  let enviar;
  let destino;
  const webhook = String(process.env.ALERTAS_DISCORD_WEBHOOK_URL || '').trim();
  if (webhook) {
    if (!esWebhookDiscord(webhook)) {
      // Se avisa del problema (sin mostrar la URL) y se cae a Telegram, para no quedar sin avisos.
      logger.warn('ALERTAS', 'ALERTAS_DISCORD_WEBHOOK_URL no es un webhook de Discord válido: se usa Telegram');
    } else {
      enviar = crearEnvioDiscord(webhook, (url, cuerpo) => require('axios').post(url, cuerpo, { timeout: 8000 }));
      destino = 'Discord';
    }
  }

  if (!enviar) {
    const { AUTHORIZED_USER_ID } = require('../config'); // lazy: config valida el entorno al cargarse
    const chatId = String(process.env.ALERTAS_CHAT_ID || '').trim() || AUTHORIZED_USER_ID;
    if (!chatId) return false;
    enviar = (texto) => {
      const { bot } = require('./telegraf');
      // warn y no error: un aviso que falla no puede disparar otro aviso.
      bot.telegram.sendMessage(chatId, texto).catch(e => logger.warn('ALERTAS', 'No se pudo enviar el aviso', { err: e.message }));
    };
    destino = 'Telegram';
  }

  logger.suscribirErrores(crearAlertas({ enviar }));
  iniciado = true;
  logger.info('ALERTAS', `Avisos de errores por ${destino} activados`);
  return true;
}

module.exports = { crearAlertas, iniciarAlertas, armarTexto, esWebhookDiscord, crearEnvioDiscord, VENTANA_MISMO_ERROR_MS, MAX_AVISOS_POR_HORA };
