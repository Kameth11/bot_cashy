const axios = require('axios');
const { bot } = require('../lib/telegraf');
const state = require('../state');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const { procesarFotoAgenda } = require('../services/vision.service');
const { confirmButtons } = require('./actions');
const { MAX_PHOTO_SIZE_BYTES, MAX_TURNOS_POR_IMAGEN } = require('../config');

function tieneProcesoPendiente(userId) {
  return state.pendingAgendaConfirm.has(userId) ||
    state.pendingRegistros.has(userId) ||
    state.pendingDeletes.has(userId) ||
    state.pendingEdits.has(userId) ||
    state.pendingCotizaciones.has(userId) ||
    state.pendingPayments.has(userId) ||
    state.pendingLimpiezas.has(userId) ||
    state.pendingReinicios.has(userId) ||
    state.pendingDescripcion.has(userId) ||
    state.pendingIngresoPacientes.has(userId);
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

    if (photo.file_size && photo.file_size > MAX_PHOTO_SIZE_BYTES) {
      return ctx.reply(`⚠️ La imagen es demasiado pesada. Máximo: ${Math.round(MAX_PHOTO_SIZE_BYTES / (1024 * 1024))} MB.`);
    }

    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const response = await axios.get(fileLink.href, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxContentLength: MAX_PHOTO_SIZE_BYTES,
      maxBodyLength: MAX_PHOTO_SIZE_BYTES,
    });
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

    if (resultado.turnos.length > MAX_TURNOS_POR_IMAGEN) {
      return ctx.reply(`⚠️ Detecté demasiados turnos (${resultado.turnos.length}). Probá recortando la imagen antes de enviarla.`);
    }

    let msg = '📅 *Turnos encontrados:*\n\n';
    resultado.turnos.forEach((turno, i) => {
      msg += `${i + 1}. `;
      const bloque = [turno.consultorio, turno.profesional].filter(Boolean).join(' - ');
      if (bloque) msg += `🏷️ ${bloque} | `;
      msg += `⏰ ${turno.hora || 'Sin horario'} - `;
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
