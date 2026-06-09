// Entry point - loads all modules and launches the bot
const { bot } = require('./lib/telegraf');
const { obtenerCotizacionDolar } = require('./services/cotizacion.service');
const { initModel } = require('./services/gemini.service');
const { startApi } = require('./api');
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
require('./handlers/commands/pendiente');
require('./handlers/commands/ingreso_paciente');
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
require('./handlers/commands/palabras');
require('./handlers/commands/sheet');
require('./handlers/commands/salir');
require('./handlers/commands/nlptest');

// Load text handler (must be AFTER commands)
require('./handlers/text');
require('./handlers/photo');

// Load callback action handlers (for inline buttons)
require('./handlers/actions');
require('./handlers/nlp-confirm');

// Start API immediately (does not depend on bot)
startApi().catch(err => console.error('Error al iniciar API:', err));

// Launch bot independently
bot.launch().then(async () => {
  console.log('Bot iniciado correctamente');
  initModel();
  await obtenerCotizacionDolar();
  console.log(`Cotizacion inicial: ${state.cotizacionDolar || 'No disponible'}`);
  const timer = setInterval(() => obtenerCotizacionDolar(), 3 * 60 * 60 * 1000);
  if (timer.unref) timer.unref();
}).catch(err => {
  console.error('Error al iniciar bot:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

module.exports = { bot };
