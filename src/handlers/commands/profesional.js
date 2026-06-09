const { bot } = require('../../lib/telegraf');
const { registrarProfesional } = require('../../services/profesional.service');
const state = require('../../state');

bot.command('profesional', async (ctx) => {
  state.pendingRegistros.set(ctx.from.id, { step: 'profesional_nombre' });
  return ctx.reply(
    '👨‍⚕️ *Registro de profesional*\n\n' +
    'Escribí tu nombre tal como aparece en la agenda del consultorio.\n' +
    'Ejemplo: `Diego` o `Dra. Maria Lopez`\n\n' +
    'Usá /cancelar para salir.',
    { parse_mode: 'Markdown' }
  );
});

async function handleProfesionalNombreStep(userId, text) {
  const nombre = text.trim();
  if (!nombre || nombre.length < 2) {
    return { message: '⚠️ Nombre inválido. Escribí tu nombre completo:' };
  }

  const result = await registrarProfesional(userId, nombre);
  state.pendingRegistros.delete(userId);

  if (!result.ok) {
    return { message: '❌ No se pudo registrar. Intentá de nuevo con /profesional' };
  }

  return {
    message:
      `✅ *¡Registrado como profesional!*\n\n` +
      `👤 Nombre: *${nombre}*\n\n` +
      `A partir de ahora vas a recibir una notificación aquí cuando llegue un paciente tuyo.`,
    parse_mode: 'Markdown'
  };
}

module.exports = { handleProfesionalNombreStep };
