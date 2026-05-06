const axios = require('axios');
const { bot } = require('../lib/telegraf');
const state = require('../state');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const { procesarFotoAgenda } = require('../services/vision.service');
const { confirmButtons } = require('./actions');

function tieneProcesoPendiente(userId) {
  return state.pendingAgendaConfirm.has(userId) ||
    state.pendingRegistros.has(userId) ||
    state.pendingDeletes.has(userId) ||
    state.pendingEdits.has(userId) ||
    state.pendingCotizaciones.has(userId) ||
    state.pendingPayments.has(userId) ||
    state.pendingLimpiezas.has(userId) ||
    state.pendingReinicios.has(userId) ||
    state.pendingDescripcion.has(userId);
}

bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;

  if (!obtenerClientePorUserId(userId) && !esAdminOriginal(userId)) {
    return ctx.reply('⚠️ No tienes una cuenta registrada.\n\nUsa /start para registrarte.');
  }

  if (tieneProcesoPendiente(userId)) {
    return ctx.reply('⚠️ Tenés un proceso pendiente. Usá /cancelar primero.');
  }

  try {
    await ctx.reply('📸 Procesando agenda...');

    const photos = ctx.message.photo || [];
    const photo = photos[photos.length - 1];
    if (!photo) {
      return ctx.reply('❌ No encontré una foto válida.');
    }

    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
    const photoBuffer = Buffer.from(response.data, 'binary');
    const resultado = await procesarFotoAgenda(photoBuffer, 'image/jpeg');

    if (!resultado) {
      return ctx.reply('❌ No pude procesar la imagen. Intenta con otra foto más clara.');
    }

    if (resultado.error === 'vision_no_configurada') {
      return ctx.reply('⚠️ La lectura de imágenes no está configurada. Revisá `GEMINI_API_KEY`.');
    }

    if (resultado.error === 'vision_dependencia_faltante') {
      return ctx.reply('⚠️ Falta instalar la dependencia de Vision. Revisá `@google/generative-ai`.');
    }

    if (resultado.error === 'no_es_agenda') {
      return ctx.reply(
        '⚠️ La imagen no parece ser una agenda o turnero.\n\n' +
        'Enviale una foto de una agenda con turnos para que los registre.'
      );
    }

    if (!resultado.turnos || resultado.turnos.length === 0) {
      return ctx.reply('📭 No encontré turnos en la imagen. Probá con una foto más clara.');
    }

    let msg = '📅 *Turnos encontrados:*\n\n';
    resultado.turnos.forEach((turno, i) => {
      msg += `${i + 1}. `;
      if (turno.hora) msg += `⏰ ${turno.hora} - `;
      msg += `👤 ${turno.cliente || 'Sin nombre'}`;
      if (turno.servicio) msg += ` (${turno.servicio})`;
      msg += '\n';
    });

    msg += `\n━━━━━━━━━━━━━━━\n`;
    msg += `📊 Total: ${resultado.turnos.length} turno${resultado.turnos.length !== 1 ? 's' : ''}`;

    state.pendingAgendaConfirm.set(userId, { turnos: resultado.turnos });

    await ctx.reply(msg, {
      parse_mode: 'Markdown',
      ...confirmButtons('confirm_agenda', 'cancel_agenda')
    });
  } catch (error) {
    console.error('Error al procesar foto:', error.message);
    await ctx.reply('❌ Error al procesar la imagen. Intenta de nuevo.');
  }
});

module.exports = {};
