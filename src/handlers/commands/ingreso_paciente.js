const { bot } = require('../../lib/telegraf');
const state = require('../../state');

bot.command('ingreso_paciente', async (ctx) => {
  const userId = ctx.from.id;

  state.pendingIngresoPacientes.set(userId, {
    step: 'paciente',
    data: {
      tipo: 'Ingreso',
      categoria: null,
      pacienteNombre: null,
      profesionalNombre: null,
      tratamientoNombre: null,
      descripcion: null,
      monto: null,
      moneda: 'Pesos',
      metodo_pago: null,
      estado: 'Cobrado',
    },
  });

  return ctx.reply(
    '🧾 *Nuevo ingreso de paciente*\n\n' +
    'Vamos a cargarlo paso a paso.\n\n' +
    '1. Escribí el nombre del paciente:',
    { parse_mode: 'Markdown' }
  );
});

module.exports = {};
