const axios = require('axios');
const { Markup } = require('telegraf');
const { bot } = require('../lib/telegraf');
const state = require('../state');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const { procesarFotoAgenda } = require('../services/vision.service');
const { resolverProfesional, obtenerConsultorioMap } = require('../services/agenda.service');
const { resolveTenantId } = require('../services/tenant.service');
const { confirmButtons } = require('./actions');
const { MAX_PHOTO_SIZE_BYTES, MAX_TURNOS_POR_IMAGEN } = require('../config');
const { tieneProcesoPendiente } = require('./guards');
const { geminiMediaSemaphore } = require('../lib/semaphore');
const aiQuota = require('../lib/ai-quota');
const { requierePermisoBot, tienePermisoBot } = require('../auth/bot-permisos');
const { escapeMarkdown } = require('../utils/formatter');
const { esArchivoWeb } = require('../lib/archivo-web');
const textos = require('../messages');

// ── Entrada común: foto o archivo (PDF / imagen sin comprimir) ───────────────

const MIME_ACEPTADOS = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

// Pista explícita en el texto que acompaña la foto: evita la clasificación
// (y su llamada a Gemini) cuando el usuario ya dijo qué es.
function tipoPorCaption(caption) {
  const t = String(caption || '').toLowerCase();
  if (!t) return null;
  // \b de JS no entiende tildes ("pagó"): se delimitan las palabras a mano.
  const palabra = (re) => new RegExp(`(^|[^a-z0-9áéíóúñ])(${re})(?=$|[^a-z0-9áéíóúñ])`).test(t);
  if (palabra('agenda|turnos?|turnero')) return 'agenda';
  if (palabra('factura|ticket|recibo|gasto|compra|boleta')) return 'factura';
  if (palabra('transferencia|comprobante de pago|me pag[oó]|pag[oó]')) return 'transferencia';
  return null;
}

async function descargarArchivo(ctx, fileId, maxBytes) {
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const response = await axios.get(fileLink.href, {
    responseType: 'arraybuffer',
    timeout: 20000,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
  });
  return Buffer.from(response.data, 'binary');
}

// Cuota diaria de lectura de imágenes/audios (1 unidad por archivo recibido).
function consumirCuotaMedia(ctx, userId) {
  const cuota = aiQuota.consumir(userId, 'media');
  if (cuota.ok) return true;
  if (cuota.avisar) {
    ctx.reply(textos.limites.mediaDiarioIA(cuota.limite)).catch(() => {});
  }
  return false;
}

async function procesarArchivoRecibido(ctx, { fileId, fileSize, mimeType, caption }) {
  const userId = ctx.from.id;

  if (!obtenerClientePorUserId(userId) && !esAdminOriginal(userId)) {
    return ctx.reply(textos.photo.noTienesUnaCuentaRegistrada);
  }

  // Una foto puede ser una agenda (editar_agenda) o un comprobante
  // (cargar_movimientos). Sin ninguno de los dos no se gasta Gemini.
  const puedeAgenda = tienePermisoBot(userId, 'editar_agenda');
  const puedeComprobante = tienePermisoBot(userId, 'cargar_movimientos');
  if (!puedeAgenda && !puedeComprobante) {
    requierePermisoBot(ctx, 'editar_agenda', 'foto_agenda');
    return;
  }

  if (tieneProcesoPendiente(userId)) {
    return ctx.reply(textos.photo.tenesUnProcesoPendienteUsa);
  }

  if (!consumirCuotaMedia(ctx, userId)) return;

  try {
    await ctx.reply(puedeComprobante ? textos.limites.procesandoImagen : textos.limites.procesandoAgenda);

    if (fileSize && fileSize > MAX_PHOTO_SIZE_BYTES) {
      return ctx.reply(textos.limites.archivoPesado(Math.round(MAX_PHOTO_SIZE_BYTES / (1024 * 1024))));
    }

    const buffer = await descargarArchivo(ctx, fileId, MAX_PHOTO_SIZE_BYTES);
    // Un archivo del chat web no tiene file_id de Telegram: sin él, el comprobante
    // no guarda una referencia falsa y el archivo se respalda por otro camino.
    const archivo = esArchivoWeb(fileId)
      ? { buffer, mimeType, fileId: null, origen: 'web' }
      : { buffer, mimeType, fileId };

    // Solo agenda: se mantiene el flujo de siempre, sin clasificar.
    if (!puedeComprobante) return await procesarAgenda(ctx, archivo);

    let tipo = tipoPorCaption(caption);
    if (!tipo) {
      const clasificacion = await clasificar(archivo);
      // Si la clasificación falla (sin clave, modelo caído), se cae al
      // comportamiento histórico: agenda si puede, si no comprobante.
      if (!clasificacion || clasificacion.error) {
        tipo = puedeAgenda ? 'agenda' : 'factura';
      } else if (clasificacion.tipo === 'otro' || clasificacion.confianza < 0.6) {
        return await preguntarTipo(ctx, archivo, { puedeAgenda });
      } else {
        tipo = clasificacion.tipo;
      }
    }

    return await derivarPorTipo(ctx, tipo, archivo);
  } catch (error) {
    if (error.code === 'SEMAPHORE_QUEUE_FULL') {
      return ctx.reply(textos.photo.estoyProcesandoVariasImagenesAhora);
    }
    console.error('Error al procesar foto:', error.message);
    await ctx.reply(textos.photo.errorAlProcesarLaImagen);
  }
}

async function clasificar(archivo) {
  const { clasificarDocumento } = require('../services/comprobante-vision.service');
  return geminiMediaSemaphore.run(() => clasificarDocumento(archivo.buffer, archivo.mimeType));
}

async function derivarPorTipo(ctx, tipo, archivo) {
  if (tipo === 'agenda') {
    if (!requierePermisoBot(ctx, 'editar_agenda', 'foto_agenda')) return;
    return procesarAgenda(ctx, archivo);
  }
  const comprobantes = require('./comprobante');
  if (tipo === 'transferencia') return comprobantes.procesarTransferencia(ctx, archivo);
  return comprobantes.procesarFactura(ctx, archivo);
}

// Cuando la IA no está segura, se pregunta. El archivo queda en memoria unos
// minutos (TTL) hasta que el usuario elige.
async function preguntarTipo(ctx, archivo, { puedeAgenda }) {
  const userId = ctx.from.id;
  const fila = [];
  if (puedeAgenda) fila.push(Markup.button.callback(textos.photo.agenda, 'doc_tipo_agenda'));
  fila.push(Markup.button.callback(textos.photo.gasto, 'doc_tipo_factura'));
  fila.push(Markup.button.callback(textos.photo.cobro, 'doc_tipo_transferencia'));
  await ctx.reply(textos.photo.noEstoySeguroDeQue, Markup.inlineKeyboard([
    fila,
    [Markup.button.callback(textos.photo.nada, 'doc_tipo_cancelar')],
  ]));
  state.pendingDocumentoTipo.set(userId, archivo);
}

async function handleElegirTipo(ctx, tipo) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const archivo = state.pendingDocumentoTipo.get(userId);
  state.pendingDocumentoTipo.delete(userId);
  if (!archivo) return ctx.editMessageText(textos.photo.laImagenExpiroMandalaDe);
  if (tipo === 'cancelar') return ctx.editMessageText(textos.photo.listoNoCargueNada);
  await ctx.editMessageText(textos.photo.procesando);
  try {
    return await derivarPorTipo(ctx, tipo, archivo);
  } catch (error) {
    if (error.code === 'SEMAPHORE_QUEUE_FULL') {
      return ctx.reply(textos.photo.estoyProcesandoVariasImagenesAhora);
    }
    console.error('Error al procesar archivo:', error.message);
    return ctx.reply(textos.photo.errorAlProcesarLaImagen);
  }
}

bot.action('doc_tipo_agenda', ctx => handleElegirTipo(ctx, 'agenda'));
bot.action('doc_tipo_factura', ctx => handleElegirTipo(ctx, 'factura'));
bot.action('doc_tipo_transferencia', ctx => handleElegirTipo(ctx, 'transferencia'));
bot.action('doc_tipo_cancelar', ctx => handleElegirTipo(ctx, 'cancelar'));

bot.on('photo', async (ctx) => {
  const photos = ctx.message.photo || [];
  const photo = photos[photos.length - 1];
  if (!photo) {
    return ctx.reply(textos.photo.noEncontreUnaFotoValida);
  }
  return procesarArchivoRecibido(ctx, {
    fileId: photo.file_id,
    fileSize: photo.file_size,
    mimeType: 'image/jpeg',
    caption: ctx.message.caption,
  });
});

// PDFs e imágenes mandadas "como archivo" (sin comprimir).
bot.on('document', async (ctx) => {
  const doc = ctx.message.document || {};
  const mimeType = String(doc.mime_type || '').toLowerCase();
  if (!MIME_ACEPTADOS.has(mimeType)) {
    return ctx.reply(textos.photo.porAhoraLeoFotosY);
  }
  return procesarArchivoRecibido(ctx, {
    fileId: doc.file_id,
    fileSize: doc.file_size,
    mimeType,
    caption: ctx.message.caption,
  });
});

// ── Agenda ───────────────────────────────────────────────────────────────────

async function procesarAgenda(ctx, { buffer, mimeType }) {
  const userId = ctx.from.id;

  let resultado;
  try {
    resultado = await geminiMediaSemaphore.run(() => procesarFotoAgenda(buffer, mimeType === 'application/pdf' ? mimeType : 'image/jpeg'));
  } catch (e) {
    if (e.code === 'SEMAPHORE_QUEUE_FULL') {
      return ctx.reply(textos.photo.estoyProcesandoVariasImagenesAhora);
    }
    throw e;
  }
  if (!resultado) {
    return ctx.reply(textos.photo.noPudeProcesarLaImagen);
  }

  if (resultado.error === 'vision_no_configurada') {
    return ctx.reply(textos.photo.laLecturaDeImagenesNo);
  }

  if (resultado.error === 'vision_dependencia_faltante') {
    return ctx.reply(textos.photo.faltaInstalarLaDependenciaDe);
  }

  if (resultado.error === 'no_es_agenda') {
    return ctx.reply(textos.limites.imagenNoEsAgenda);
  }

  if (!resultado.turnos || resultado.turnos.length === 0) {
    return ctx.reply(textos.photo.noEncontreTurnosEnLa);
  }

  if (resultado.turnos.length > MAX_TURNOS_POR_IMAGEN) {
    return ctx.reply(textos.limites.demasiadosTurnos(resultado.turnos.length));
  }

  const mapaConsultorios = await obtenerConsultorioMap(await resolveTenantId(userId));

  let msg = '📅 *Turnos encontrados:*\n\n';
  resultado.turnos.forEach((turno, i) => {
    msg += `${i + 1}. `;
    const profesionalResuelto = resolverProfesional(turno.profesional, turno.consultorio, mapaConsultorios);
    const bloque = [turno.consultorio, profesionalResuelto].filter(Boolean).map(escapeMarkdown).join(' - ');
    if (bloque) msg += `🏷️ ${bloque} | `;
    msg += `⏰ ${escapeMarkdown(turno.hora || 'Sin horario')} - `;
    msg += `👤 ${escapeMarkdown(turno.cliente || 'Sin nombre')}`;
    if (turno.servicio) msg += ` (${escapeMarkdown(turno.servicio)})`;
    msg += '\n';
  });

  msg += `\n━━━━━━━━━━━━━━━\n`;
  msg += `📊 Total: ${resultado.turnos.length} turno${resultado.turnos.length !== 1 ? 's' : ''}`;

  // El estado se setea DESPUÉS de que el envío salga bien: si Telegram
  // rechaza el mensaje (ej. Markdown roto por un nombre con _ o *), antes
  // pendingAgendaConfirm quedaba seteado igual y el usuario quedaba
  // trabado con "tenés un proceso pendiente" sin ver nunca los botones.
  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    ...confirmButtons('confirm_agenda', 'cancel_agenda')
  });

  state.pendingAgendaConfirm.set(userId, { turnos: resultado.turnos });
}

module.exports = { tipoPorCaption, procesarArchivoRecibido };
