const { bot } = require('../../lib/telegraf');

bot.command('ayuda', (ctx) => {
  ctx.reply(
    '📖 *Comandos disponibles:*\n\n' +
    '📝 *Registrar movimiento:*\n' +
    '`consulta [paciente] $[monto] [metodo]`\n' +
    '`servicio [tratamiento] $[monto] [metodo]`\n' +
    '`gasto [descripcion] $-[monto]`\n\n' +
    '💵 *Monedas:*\n' +
    '$ - Pesos | U$ / USD - Dólares\n\n' +
    '💳 *Método de pago:*\n' +
    'efectivo / transferencia / tarjeta\n\n' +
    '📊 *Reportes:*\n' +
    '`/balance` - Resumen completo\n' +
    '`/hoy` - Movimientos de hoy\n' +
    '`/pendientes` - Sin cobrar\n' +
    '`/semana` - Resumen semanal\n' +
    '`/mes` - Balance del mes\n' +
    '`/ingresos` - Solo ingresos\n' +
    '`/egresos` - Solo gastos\n\n' +
    '✅ *Cobrar:*\n' +
    '`/cobrar ultimo` - Cobra el último pendiente\n' +
    '`/cobrar [nombre]` - Cobra uno que coincida\n\n' +
    '✏️ *Editar:*\n' +
    '`/editar [nombre]` - Editar descripción y monto\n\n' +
    '🗑️ *Eliminar:*\n' +
    '`/eliminar [nombre]` - Eliminar movimiento\n' +
    '`/listar` - Ver todos los movimientos\n\n' +
    '💵 *Dólar:*\n' +
    '`/dolar` - Ver cotización actual\n' +
    '`/actualizardolar` - Actualizar cotización',
    { parse_mode: 'Markdown' }
  );
});

module.exports = {};
