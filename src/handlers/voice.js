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
const aiQuota = require('../lib/ai-quota');
const { requierePermisoBot } = require('../auth/bot-permisos');
const { puedeUsarPersonal } = require('../auth/personal-acceso');
const textos = require('../messages');

bot.on('voice', async (ctx) => {
  const userId = ctx.from.id;

  if (!obtenerClientePorUserId(userId) && !esAdminOriginal(userId)) {
    return ctx.reply(textos.voice.noTienesUnaCuentaRegistrada);
  }

  // Quien puede usar Personal puede dictar un gasto personal aunque no cargue en el consultorio:
  // el permiso del consultorio se exige más adelante, según el ámbito que salga del audio.
  if (!puedeUsarPersonal(userId) && !requierePermisoBot(ctx, 'cargar_movimientos', 'nota_voz')) return;

  if (tieneProcesoPendiente(userId)) {
    return ctx.reply(textos.voice.tenesUnProcesoPendienteUsa);
  }

  try {
    const voice = ctx.message.voice;
    if (!voice) {
      return ctx.reply(textos.voice.noEncontreUnaNotaDe);
    }

    if (voice.duration && voice.duration > MAX_VOICE_DURATION_SECONDS) {
      return ctx.reply(textos.limites.audioLargo(MAX_VOICE_DURATION_SECONDS));
    }

    if (voice.file_size && voice.file_size > MAX_VOICE_SIZE_BYTES) {
      return ctx.reply(textos.limites.audioPesado(Math.round(MAX_VOICE_SIZE_BYTES / (1024 * 1024))));
    }

    const cuota = aiQuota.consumir(userId, 'media');
    if (!cuota.ok) {
      if (cuota.avisar) {
        await ctx.reply(textos.limites.mediaDiarioIA(cuota.limite));
      }
      return;
    }

    await ctx.reply(textos.voice.transcribiendoAudio);

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
      transcripcion = await geminiMediaSemaphore.run(() => geminiService.transcribirAudio(audioBuffer, voice.mime_type || 'audio/ogg'));
    } catch (e) {
      if (e.code === 'SEMAPHORE_QUEUE_FULL') {
        return ctx.reply(textos.voice.estoyProcesandoVariosAudiosAhora);
      }
      throw e;
    }

    if (transcripcion == null) {
      return ctx.reply(textos.voice.noPudeTranscribirElAudio);
    }

    const textoValidacion = validarTextoUsuario(transcripcion);
    if (!textoValidacion.ok || !transcripcion.trim()) {
      return ctx.reply(textos.voice.noEntendiNadaEnEl);
    }

    await ctx.reply(textos.limites.transcripcion(escapeMarkdown(transcripcion.trim())), { parse_mode: 'Markdown' });

    return procesarTextoConNlp(ctx, transcripcion.trim());
  } catch (error) {
    console.error('Error al procesar nota de voz:', error.message);
    await ctx.reply(textos.voice.errorAlProcesarLaNota);
  }
});

module.exports = {};
