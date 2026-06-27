const { bot } = require('../../lib/telegraf');
const cmd = require('../../services/command.service');
const { mostrarCobrar } = require('../cobrar-confirm');

bot.command('cobrar', async (ctx) => {
  try {
    const texto = ctx.message.text.replace('/cobrar', '').trim();
    const resultado = await cmd.buscarCandidatosCobrar(ctx.from.id, texto || null);
    return mostrarCobrar(ctx, resultado);
  } catch (error) {
    console.error('Error /cobrar:', error.message);
    ctx.reply('❌ Error al buscar pendientes.');
  }
});

module.exports = {};
