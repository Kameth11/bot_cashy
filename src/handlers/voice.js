const axios = require('axios');
const { bot } = require('../lib/telegraf');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const geminiService = require('../services/gemini.service');
const { MAX_VOICE_SIZE_BYTES, MAX_VOICE_DURATION_SECONDS } = require('../config');
const { tieneProcesoPendiente } = require('./guards');
const { validarTextoUsuario } = require('../utils/validation');
const { escapeMarkdown } = require('../utils/formatter');
const { procesarTextoConNlp } = require('./text');
const { geminiMediaSemaphore } = require('../lib/semaphore');

bot.on('voice', async (ctx) => {
  const userId = ctx.from.id;

  if (!obtenerClientePorUserId(userId) && !esAdminOriginal(userId)) {
    return ctx.reply('⚠️ No tienes una cuenta registrada.\n\nUsa /start para registrarte.');
  }

  if (tieneProcesoPendiente(userId)) {
    return ctx.reply('⚠️ Tenés un proceso pendiente. Usá /cancelar primero.');
  }

  try {
    const voice = ctx.message.voice;
    if (!voice) {
      return ctx.reply('❌ No encontré una nota de voz válida.');
    }

    if (voice.duration && voice.duration > MAX_VOICE_DURATION_SECONDS) {
      return ctx.reply(`⚠️ El audio es demasiado largo. Máximo: ${MAX_VOICE_DURATION_SECONDS} segundos.`);
    }

    if (voice.file_size && voice.file_size > MAX_VOICE_SIZE_BYTES) {
      return ctx.reply(`⚠️ El audio es demasiado pesado. Máximo: ${Math.round(MAX_VOICE_SIZE_BYTES / (1024 * 1024))} MB.`);
    }

    await ctx.reply('🎤 Transcribiendo audio...');

    const fileLink = await ctx.telegram.getFileLink(voice.file_id);
    const response = await axios.get(fileLink.href, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxContentLength: MAX_VOICE_SIZE_BYTES,
      maxBodyLength: MAX_VOICE_SIZE_BYTES,
    });
    const audioBuffer = Buffer.from(response.data, 'binary');

    let transcripcion;
    try {
      transcripcion = await geminiMediaSemaphore.run(() => geminiService.transcribirAudio(audioBuffer, 'audio/ogg'));
    } catch (e) {
      if (e.code === 'SEMAPHORE_QUEUE_FULL') {
        return ctx.reply('⏳ Estoy procesando varios audios ahora mismo. Probá de nuevo en unos segundos.');
      }
      throw e;
    }

    if (transcripcion == null) {
      return ctx.reply('⚠️ No pude transcribir el audio. Probá escribiendo el mensaje en texto.');
    }

    const textoValidacion = validarTextoUsuario(transcripcion);
    if (!textoValidacion.ok || !transcripcion.trim()) {
      return ctx.reply('❌ No entendí nada en el audio. Probá grabarlo de nuevo más claro.');
    }

    await ctx.reply(`🎤 "${escapeMarkdown(transcripcion.trim())}"`, { parse_mode: 'Markdown' });

    return procesarTextoConNlp(ctx, transcripcion.trim());
  } catch (error) {
    console.error('Error al procesar nota de voz:', error.message);
    await ctx.reply('❌ Error al procesar la nota de voz. Intenta de nuevo.');
  }
});

module.exports = {};
