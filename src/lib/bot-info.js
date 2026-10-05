// Username del bot de Telegram (para armar t.me/<bot>?start=...).
//
// No se usa bot.botInfo: la API arranca ANTES que bot.launch() (src/index.js),
// así que todavía no está cargado. Se pide con getMe() la primera vez y se cachea.
// BOT_USERNAME (opcional) tiene prioridad y evita la llamada.

let cache = null;

async function obtenerUsernameBot() {
  const manual = String(process.env.BOT_USERNAME || '').replace(/^@/, '').trim();
  if (manual) return manual;
  if (cache) return cache;

  const { bot } = require('./telegraf');
  const me = await bot.telegram.getMe();
  cache = me && me.username ? me.username : null;
  return cache;
}

function _reiniciarCache() { cache = null; }

module.exports = { obtenerUsernameBot, _reiniciarCache };
