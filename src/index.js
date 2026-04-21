// Entry point - loads all modules and launches the bot
const { bot } = require('./lib/telegraf');
const { obtenerCotizacionDolar } = require('./services/cotizacion.service');
const state = require('./state');

// Load middleware (must be first, before commands)
require('./handlers/middleware');

// Load all command handlers
require('./handlers/commands/start');
require('./handlers/commands/ayuda');
require('./handlers/commands/balance');
require('./handlers/commands/hoy');
require('./handlers/commands/semana');
require('./handlers/commands/mes');
require('./handlers/commands/ingresos');
require('./handlers/commands/egresos');
require('./handlers/commands/pendientes');
require('./handlers/commands/cobrar');
require('./handlers/commands/eliminar');
require('./handlers/commands/editar');
require('./handlers/commands/listar');
require('./handlers/commands/debug');
require('./handlers/commands/limpiar');
require('./handlers/commands/dolar');
require('./handlers/commands/actualizardolar');
require('./handlers/commands/cancelar');
require('./handlers/commands/help');
require('./handlers/commands/codigo');
require('./handlers/commands/unir');
require('./handlers/commands/misusuarios');
require('./handlers/commands/reiniciar');
require('./handlers/commands/regenerar_ids');

// Load text handler (must be AFTER commands)
require('./handlers/text');

// Launch bot
bot.launch().then(async () => {
  console.log('Bot iniciado correctamente');
  await obtenerCotizacionDolar();
  console.log(`Cotizacion inicial: ${state.cotizacionDolar || 'No disponible'}`);
}).catch(err => {
  console.error('Error al iniciar:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = { bot };
