// Entry point - loads all modules and launches the bot
const { bot } = require('./lib/telegraf');
const { obtenerCotizacionDolar } = require('./services/cotizacion.service');
const { initModel } = require('./services/gemini.service');
const { startApi } = require('./api');
const state = require('./state');
const logger = require('./lib/logger');

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
require('./handlers/commands/profesional');
require('./handlers/commands/editarturno');

// Load text handler (must be AFTER commands)
require('./handlers/text');
require('./handlers/photo');
require('./handlers/voice');

// Load callback action handlers (for inline buttons)
require('./handlers/actions');
require('./handlers/nlp-confirm');

// Start API immediately (does not depend on bot)
startApi().catch(err => logger.error('PROCESS', 'Error al iniciar API', { err: err.message }));

// Launch bot independently
bot.launch().then(async () => {
  logger.info('BOT', 'Bot iniciado correctamente');
  initModel();
  await obtenerCotizacionDolar();
  logger.info('BOT', `Cotizacion inicial: ${state.cotizacionDolar || 'No disponible'}`);
  const timer = setInterval(() => obtenerCotizacionDolar(), 3 * 60 * 60 * 1000);
  if (timer.unref) timer.unref();
}).catch(err => {
  logger.error('PROCESS', 'Error al iniciar bot', { err: err.message });
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('PROCESS', 'Unhandled Rejection', { reason: reason instanceof Error ? reason.message : reason });
});

process.on('uncaughtException', (err) => {
  logger.error('PROCESS', 'Uncaught Exception', { err: err.message, stack: err.stack });
});

module.exports = { bot };
