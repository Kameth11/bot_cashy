// Arranca el bot de Telegram y sobrevive a un 409 ("Conflict: terminated by other getUpdates request").
//
// Telegram deja leer los mensajes de un bot a UNA sola instancia. Si hay dos a la vez (típico: en un deploy de
// Railway la instancia vieja sigue viva mientras arranca la nueva) Telegraf NO reintenta: lanza el 409 y
// `bot.launch()` termina. Antes eso solo se logueaba y la app seguía con la API arriba pero sin leer
// mensajes, y como el health check pasaba, nadie la reiniciaba: el bot quedaba muerto hasta el próximo deploy.
//
// Acá se reintenta cada 5 s. Mientras dura el solapamiento normal de un deploy es un `warn` (no avisa);
// si pasa de ~1 minuto es que hay OTRA copia del bot corriendo (¿una compu con el mismo token, otro servicio
// de Railway?) y entonces sí es un `error`, que avisa por Discord.
//
// Nota: en Telegraf 4.16 `bot.launch()` solo resuelve cuando el bot se DETIENE (el long polling corre dentro).
// Lo que haya que hacer "al arrancar" va en `alConectar`, que Telegraf llama apenas conecta.

const ESPERA_MS = 5000;
const INTENTOS_HASTA_ERROR = 12; // ~1 minuto

const esConflicto = (err) => Boolean(err && (err.code === 409 || (err.response && err.response.error_code === 409)));
const esperarMs = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {object} p
 * @param {(alConectar: Function) => Promise<void>} p.launch  llama a bot.launch; resuelve cuando el bot se detiene
 * @param {Function} p.alConectar  se pasa a Telegraf; tiene que tolerar llamarse más de una vez
 * @param {object} p.logger
 * @param {(ms:number)=>Promise<void>} [p.esperar]
 * @param {()=>boolean} [p.estaApagando]
 */
async function lanzarBot({ launch, alConectar, logger, esperar = esperarMs, estaApagando = () => false }) {
  for (let intento = 1; ; intento++) {
    try {
      await launch(alConectar);
      return;
    } catch (err) {
      if (!esConflicto(err)) throw err;
      if (estaApagando()) return;

      if (intento === INTENTOS_HASTA_ERROR) {
        logger.error('BOT', 'Hace más de un minuto que otra instancia del bot lee los mensajes de Telegram (409). Si no es un deploy en curso, hay otra copia corriendo con el mismo token: este bot NO está recibiendo mensajes. Se sigue reintentando.', { intento });
      } else if (intento < INTENTOS_HASTA_ERROR) {
        logger.warn('BOT', 'Otra instancia está leyendo los mensajes de Telegram (409): se reintenta en unos segundos (normal durante un deploy)', { intento });
      }
      await esperar(ESPERA_MS);
      if (estaApagando()) return;
    }
  }
}

module.exports = { lanzarBot, esConflicto, ESPERA_MS, INTENTOS_HASTA_ERROR };
