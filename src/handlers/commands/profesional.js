const { bot } = require('../../lib/telegraf');
const { registrarProfesional } = require('../../services/profesional.service');
const { resolveTenantId } = require('../../services/tenant.service');
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

  state.pendingRegistros.set(userId, { step: 'profesional_consultorio', nombre });

  return {
    message:
      `👤 Nombre: *${nombre}*\n\n` +
      `¿En qué consultorio atendés? (ej: "Consultorio 1"). Esto es lo que va a permitir que el bot ` +
      `te asigne automáticamente los turnos al leer una foto de la agenda.\n\n` +
      `Si no aplica, escribí "ninguno".`,
    parse_mode: 'Markdown'
  };
}

async function handleProfesionalConsultorioStep(userId, text, registro) {
  const texto = text.trim();
  const consultorio = /^(ninguno|no|-)$/i.test(texto) ? null : texto;

  const tenantId = await resolveTenantId(userId);
  const result = await registrarProfesional(tenantId, userId, registro.nombre, consultorio);
  state.pendingRegistros.delete(userId);

  if (!result.ok) {
    return { message: '❌ No se pudo registrar. Intentá de nuevo con /profesional' };
  }

  return {
    message:
      `✅ *¡Registrado como profesional!*\n\n` +
      `👤 Nombre: *${registro.nombre}*\n` +
      `${consultorio ? `🏷️ Consultorio: *${consultorio}*\n` : ''}\n` +
      `A partir de ahora vas a recibir una notificación aquí cuando llegue un paciente tuyo.`,
    parse_mode: 'Markdown'
  };
}

module.exports = { handleProfesionalNombreStep, handleProfesionalConsultorioStep };
