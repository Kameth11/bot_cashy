const { bot } = require('../../lib/telegraf');
const { esAdminOriginal, obtenerClientePorUserId, resetIntentosEmail } = require('../../auth');
const state = require('../../state');

bot.command('start', (ctx) => {
  const userId = ctx.from.id;

  if (esAdminOriginal(userId)) {
    return ctx.reply(
      '\u{1F44B} \u{00A1}Hola! Soy tu bot de cashflow para consultorio.\n\n' +
      '\u{1F4DD} *Registrar movimiento:*\n' +
      '`consulta Juan Perez $15000 efectivo` (ingreso pesos)\n' +
      '`servicio Endodoncia U$50 transferencia` (ingreso d\u{00F3}lares)\n' +
      '`gasto Insumos $-500` (egreso)\n\n' +
      '\u{1F4CA} *Reportes:*\n' +
      '`/balance` - Resumen completo\n' +
      '`/hoy` - Movimientos de hoy\n' +
      '`/pendientes` - Sin cobrar\n\n' +
      '`/ayuda` - Ver todos los comandos',
      { parse_mode: 'Markdown' }
    );
  }

  const cliente = obtenerClientePorUserId(userId);
  if (cliente) {
    return ctx.reply(
      '\u{1F44B} \u{00A1}Bienvenido de nuevo a tu bot de cashflow!\n\n' +
      '\u{1F4DD} *Registrar movimiento:*\n' +
      '`consulta Juan Perez $15000 efectivo` (ingreso pesos)\n' +
      '`servicio Endodoncia U$50 transferencia` (ingreso d\u{00F3}lares)\n' +
      '`gasto Insumos $-500` (egreso)\n\n' +
      '\u{1F4CA} *Reportes:*\n' +
      '`/balance` - Resumen completo\n' +
      '`/hoy` - Movimientos de hoy\n' +
      '`/pendientes` - Sin cobrar\n\n' +
      '`/ayuda` - Ver todos los comandos',
      { parse_mode: 'Markdown' }
    );
  }

  state.pendingRegistros.set(userId, { step: 'email' });
  resetIntentosEmail(userId);
  ctx.reply(
    '\u{1F4E7} *Verificaci\u{00F3}n de email*\n\n' +
    'Ingresa tu email corporativo:\n' +
    'Ejemplo: `juan@tuempresa.com`\n\n' +
    'Solo emails autorizados pueden registrarse.\n' +
    'O usa /cancelar para salir.'
  );
});

module.exports = {};
