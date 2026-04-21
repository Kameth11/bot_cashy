const { bot } = require('../../lib/telegraf');
const { GoogleSpreadsheet, serviceAccountAuth } = require('../../lib/google');
const { esAdminOriginal, obtenerClientePorUserId } = require('../../auth');
const clienteService = require('../../services/cliente.service');

bot.command('reiniciar', async (ctx) => {
  const userId = ctx.from.id;

  if (!esAdminOriginal(userId)) {
    return ctx.reply('⚠️ Solo el owner puede usar este comando.');
  }

  const cliente = obtenerClientePorUserId(userId);
  const clientes = clienteService.clientes;
  delete clientes[userId];
  clienteService.guardarClientes(clientes);

  if (cliente && cliente.sheetId) {
    try {
      const docToClear = new GoogleSpreadsheet(cliente.sheetId, serviceAccountAuth);
      await docToClear.loadInfo();
      const sheetToClear = docToClear.sheetsByIndex[0];
      const rows = await sheetToClear.getRows();
      for (const row of rows) {
        await row.delete();
      }
      ctx.reply('✅ Listo. usa /start');
    } catch (error) {
      console.error('Error sheet:', error.message);
      ctx.reply('✅ Datos borrados. usa /start');
    }
  } else {
    ctx.reply('✅ Listo. usa /start');
  }
});

module.exports = {};
