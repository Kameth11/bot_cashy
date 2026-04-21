const { bot } = require('../../lib/telegraf');

bot.command('help', async (ctx) => {
  const helpMsg = `📚 *Manual de comandos*

*📝 Registrar movimientos:*
/agregar - Agregar ingreso o gasto

*📋 Ver movimientos:*
/listar - Últimos 10 movimientos
/estado - Resumen financiero (totales)

*✏️ Editar movimientos:*
/eliminar [nombre/ID] - Eliminar movimiento
/editar [nombre/ID] - Editar movimiento

*💱 Moneda:*
/dolar - Ver cotizaciones del dólar

*⚙️ Configuración:*
/configurar - Configurar tu Google Sheet
/regenerar_ids - Generar IDs faltantes

*💡 Tips:*
• Usa /eliminar o /editar seguido del nombre o ID
• Los IDs únicos permiten buscar con precisión
• /regenerar_ids llena IDs en movimientos antiguos

_Usa /agregar para registrar un movimiento_`;
  ctx.reply(helpMsg, { parse_mode: 'Markdown' });
});

module.exports = {};
