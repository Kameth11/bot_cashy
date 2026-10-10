// Canal web del bot: el chat del dashboard habla con EXACTAMENTE el mismo
// pipeline de Telegraf que Telegram (middleware de auth/rate limit, comandos,
// texto libre con quick_nlp/Gemini, notas de voz, botones de confirmación,
// permisos por invitado). No hay un segundo "cerebro": se arma un update con la
// misma forma que manda Telegram y se corre `bot.middleware()` con un objeto
// Telegram propio que, en lugar de llamar a la API de Telegram, guarda lo que
// el bot le responde a este usuario en un historial que lee la web.
//
// Lo que el bot le manda a OTRO chat (avisar al dueño, al profesional, etc.)
// sigue saliendo por Telegram de verdad, igual que antes.
//
// Límites conocidos:
//  - El historial vive en memoria y se persiste en Supabase (tabla
//    chat_historial, best-effort: sin la tabla se pierde en cada deploy, como
//    antes). Los movimientos no dependen de esto: se guardan como siempre en
//    Sheets/Supabase. Al restaurar se sacan los botones: sus confirmaciones
//    pendientes vivían en la memoria del proceso anterior.
//  - Los estados conversacionales (confirmaciones pendientes, ediciones) son
//    los del bot, por userId: si el mismo usuario usa Telegram y la web a la
//    vez, comparten la conversación en curso — igual que dos dispositivos con
//    Telegram abierto.

const crypto = require('crypto');
const { Telegram, Context } = require('telegraf');
const { bot } = require('./telegraf');
const logger = require('./logger');
const eventsService = require('../services/events.service');
const { PREFIJO_ARCHIVO_WEB } = require('./archivo-web');
const historial = require('../services/chat-historial.service');

const MAX_MENSAJES = 150;              // por usuario, los más viejos se descartan
const MAX_EDAD_MS = 30 * 24 * 60 * 60 * 1000; // al restaurar se descartan los de más de 30 días
const GUARDAR_DESPUES_MS = 1500;       // junta ráfagas de mensajes en un solo guardado
const HANDLER_TIMEOUT_MS = 120 * 1000; // audio + Gemini puede tardar
const BOT_INFO_FALLBACK = { id: 0, is_bot: true, first_name: 'Cashy', username: 'cashy_web' };

// Identifica esta "vida" del proceso: si el servidor se reinicia (deploy), los
// clientes lo notan por el cambio de época y vuelven a pedir la conversación en
// vez de comparar números de revisión de dos procesos distintos.
const EPOCA = crypto.randomUUID();

// userId (string) -> { mensajes, ultimoId, rev, cola, cargando, timerGuardado,
//                      guardando, revGuardada }
const conversaciones = new Map();
const guardadosEnCurso = new Set();

function conversacionDe(userId) {
  const key = String(userId);
  let conv = conversaciones.get(key);
  if (!conv) {
    conv = {
      mensajes: [], ultimoId: 0, rev: 0, cola: Promise.resolve(),
      cargando: null, timerGuardado: null, guardando: Promise.resolve(), revGuardada: 0,
    };
    conversaciones.set(key, conv);
  }
  return conv;
}

// Restaura el historial guardado, una sola vez por proceso y persona. Todo lo
// que lee o escribe la conversación espera a esto primero.
function asegurarCargada(userId) {
  const conv = conversacionDe(userId);
  if (!conv.cargando) {
    conv.cargando = historial.cargar(userId).then((guardado) => {
      if (!guardado) return;
      const limite = Date.now() - MAX_EDAD_MS;
      conv.mensajes = guardado.mensajes
        .filter(m => m && Number.isFinite(m.id) && Number(m.ts) >= limite)
        // Sus botones ya no sirven: las confirmaciones pendientes estaban en la
        // memoria del proceso anterior.
        .map(m => ({ ...m, botones: [] }))
        .slice(-MAX_MENSAJES);
      conv.ultimoId = Math.max(guardado.ultimoId, ...conv.mensajes.map(m => m.id), 0);
      conv.rev = guardado.rev;
      conv.revGuardada = guardado.rev;
    }).catch(() => {});
  }
  return conv.cargando;
}

// Guarda el estado actual (serializado por persona: nunca dos guardados a la vez).
function guardarAhora(userId, conv) {
  clearTimeout(conv.timerGuardado);
  conv.timerGuardado = null;
  if (conv.rev === conv.revGuardada) return conv.guardando;
  const revAGuardar = conv.rev;
  const foto = {
    mensajes: conv.mensajes.map(m => ({ ...m, botones: [] })),
    ultimoId: conv.ultimoId,
    rev: revAGuardar,
  };
  const tarea = conv.guardando.then(() => historial.guardar(userId, foto)).then((ok) => {
    if (ok && revAGuardar > conv.revGuardada) conv.revGuardada = revAGuardar;
  }).catch(() => {});
  conv.guardando = tarea;
  guardadosEnCurso.add(tarea);
  tarea.then(() => guardadosEnCurso.delete(tarea));
  return tarea;
}

function programarGuardado(userId, conv) {
  if (conv.timerGuardado) return; // ya hay uno en camino: junta esta ráfaga
  conv.timerGuardado = setTimeout(() => guardarAhora(userId, conv), GUARDAR_DESPUES_MS);
  if (conv.timerGuardado.unref) conv.timerGuardado.unref();
}

// Para el apagado ordenado: guarda ya lo que esté esperando el temporizador y
// espera (con tope) a los guardados en curso.
async function vaciarGuardados(timeoutMs = 5000) {
  for (const [userId, conv] of conversaciones) {
    if (conv.timerGuardado || conv.rev !== conv.revGuardada) guardarAhora(userId, conv);
  }
  let timer;
  const tope = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  await Promise.race([Promise.all([...guardadosEnCurso]), tope]);
  clearTimeout(timer);
}

function huboCambio(userId, conv) {
  conv.rev += 1;
  if (conv.mensajes.length > MAX_MENSAJES) conv.mensajes.splice(0, conv.mensajes.length - MAX_MENSAJES);
  programarGuardado(userId, conv);
  eventsService.emitChatUpdated(userId, conv.rev, EPOCA);
}

// Botones inline de Telegram -> forma simple para la web. Solo se conservan los
// de callback (acción del bot) y los de link; el resto no aplica a la web.
function botonesDesde(replyMarkup) {
  const filas = replyMarkup && Array.isArray(replyMarkup.inline_keyboard) ? replyMarkup.inline_keyboard : [];
  return filas
    .map(fila => (Array.isArray(fila) ? fila : [])
      .filter(b => b && !b.hide && (typeof b.callback_data === 'string' || typeof b.url === 'string'))
      .map(b => (typeof b.callback_data === 'string'
        ? { texto: String(b.text || ''), data: b.callback_data }
        : { texto: String(b.text || ''), url: b.url })))
    .filter(fila => fila.length > 0);
}

function agregarMensaje(userId, conv, campos) {
  conv.ultimoId += 1;
  const mensaje = {
    id: conv.ultimoId,
    de: 'bot',
    texto: '',
    formato: null,
    botones: [],
    ts: Date.now(),
    ...campos,
  };
  conv.mensajes.push(mensaje);
  huboCambio(userId, conv);
  return mensaje;
}

function buscarMensaje(conv, id) {
  return conv.mensajes.find(m => m.id === Number(id)) || null;
}

function mensajeTelegram(chatId, mensaje) {
  return {
    message_id: mensaje.id,
    date: Math.floor(mensaje.ts / 1000),
    chat: { id: chatId, type: 'private' },
    text: mensaje.texto,
  };
}

// Telegram "falso" para un usuario web. Hereda de Telegram para que todos los
// helpers (sendMessage, editMessageText, answerCbQuery...) armen el payload
// igual que siempre; solo se intercepta callApi.
class TelegramWeb extends Telegram {
  constructor(userId, avisos) {
    super(bot.telegram.token, bot.telegram.options);
    this.userId = String(userId);
    this.avisos = avisos;
    this.archivos = new Map(); // file_id -> { buffer, mimeType }
  }

  esEsteChat(chatId) {
    return chatId != null && String(chatId) === this.userId;
  }

  async getFileLink(fileId) {
    const archivo = this.archivos.get(String(fileId && fileId.file_id ? fileId.file_id : fileId));
    if (!archivo) return super.getFileLink(fileId);
    // axios (que usan voice.js/photo.js para bajar el archivo) lee data: URLs.
    return new URL(`data:${archivo.mimeType};base64,${archivo.buffer.toString('base64')}`);
  }

  async callApi(method, payload = {}, opts) {
    if (method === 'answerCallbackQuery') {
      if (payload.text) this.avisos.push(String(payload.text));
      return true;
    }
    if (!this.esEsteChat(payload.chat_id)) {
      // Otro chat (dueño, profesional, miembro de una casa): Telegram real.
      return super.callApi(method, payload, opts);
    }

    const conv = conversacionDe(this.userId);
    switch (method) {
      case 'sendMessage': {
        const m = agregarMensaje(this.userId, conv, {
          texto: String(payload.text || ''),
          formato: payload.parse_mode || null,
          botones: botonesDesde(payload.reply_markup),
        });
        return mensajeTelegram(payload.chat_id, m);
      }
      case 'editMessageText': {
        const m = buscarMensaje(conv, payload.message_id);
        if (!m) throw new Error('Bad Request: message to edit not found');
        m.texto = String(payload.text || '');
        m.formato = payload.parse_mode || null;
        // Como en Telegram: editar el texto sin reply_markup saca los botones.
        m.botones = botonesDesde(payload.reply_markup);
        m.editado = true;
        huboCambio(this.userId, conv);
        return mensajeTelegram(payload.chat_id, m);
      }
      case 'editMessageReplyMarkup': {
        const m = buscarMensaje(conv, payload.message_id);
        if (!m) throw new Error('Bad Request: message to edit not found');
        m.botones = botonesDesde(payload.reply_markup);
        huboCambio(this.userId, conv);
        return mensajeTelegram(payload.chat_id, m);
      }
      case 'deleteMessage': {
        const i = conv.mensajes.findIndex(m => m.id === Number(payload.message_id));
        if (i >= 0) {
          conv.mensajes.splice(i, 1);
          huboCambio(this.userId, conv);
        }
        return true;
      }
      case 'sendChatAction':
        return true;
      case 'sendDocument':
      case 'sendPhoto': {
        const m = agregarMensaje(this.userId, conv, {
          texto: payload.caption ? String(payload.caption) : '📎 Archivo enviado (se ve desde Telegram).',
          formato: payload.parse_mode || null,
        });
        return mensajeTelegram(payload.chat_id, m);
      }
      default:
        logger.warn('CHAT_WEB', 'Método de Telegram sin soporte en el canal web', { method });
        return true;
    }
  }
}

let ultimoUpdateId = 0;

function usuarioTelegram(userId, nombre) {
  return { id: Number(userId), is_bot: false, first_name: nombre || 'Usuario', language_code: 'es' };
}

function chatDe(userId, nombre) {
  return { id: Number(userId), type: 'private', first_name: nombre || 'Usuario' };
}

// Corre el pipeline completo del bot para un update armado a mano.
async function correrUpdate(userId, update, telegram) {
  const ctx = new Context(update, telegram, bot.botInfo || BOT_INFO_FALLBACK);
  Object.assign(ctx, bot.context);
  let timer;
  try {
    await Promise.race([
      Promise.resolve(bot.middleware()(ctx, () => Promise.resolve())),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Tiempo de espera agotado en el canal web')), HANDLER_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    // Mismo manejo que un update de Telegram (bot.catch avisa al usuario).
    try {
      await bot.handleError(err, ctx);
    } catch (e) {
      logger.error('CHAT_WEB', 'Error procesando update web', { err: err.message });
    }
  } finally {
    clearTimeout(timer);
  }
}

// Serializa por usuario: dos mensajes seguidos no se pisan los estados.
function enCola(userId, fn) {
  const conv = conversacionDe(userId);
  const corrida = conv.cola.then(fn, fn);
  conv.cola = corrida.catch(() => {});
  return corrida;
}

function snapshot(userId, avisos = []) {
  const conv = conversacionDe(userId);
  return { epoca: EPOCA, rev: conv.rev, mensajes: conv.mensajes.map(m => ({ ...m, botones: m.botones.map(f => f.slice()) })), avisos };
}

async function obtenerConversacion(userId) {
  await asegurarCargada(userId);
  return snapshot(userId);
}

function entidadesDeComando(texto) {
  if (!texto.startsWith('/')) return undefined;
  const primera = texto.split(/\s/)[0];
  return [{ type: 'bot_command', offset: 0, length: primera.length }];
}

async function enviarTexto(userId, texto, { nombre } = {}) {
  const limpio = String(texto || '').trim();
  return enCola(userId, async () => {
    await asegurarCargada(userId);
    const avisos = [];
    const telegram = new TelegramWeb(userId, avisos);
    const conv = conversacionDe(userId);
    const propio = agregarMensaje(userId, conv, { de: 'yo', texto: limpio });
    const message = {
      message_id: propio.id,
      date: Math.floor(propio.ts / 1000),
      chat: chatDe(userId, nombre),
      from: usuarioTelegram(userId, nombre),
      text: limpio,
    };
    const entities = entidadesDeComando(limpio);
    if (entities) message.entities = entities;
    await correrUpdate(userId, { update_id: ++ultimoUpdateId, message }, telegram);
    return snapshot(userId, avisos);
  });
}

async function enviarAudio(userId, { buffer, mimeType, duracion }, { nombre } = {}) {
  return enCola(userId, async () => {
    await asegurarCargada(userId);
    const avisos = [];
    const telegram = new TelegramWeb(userId, avisos);
    const fileId = `web-${crypto.randomUUID()}`;
    telegram.archivos.set(fileId, { buffer, mimeType });
    const conv = conversacionDe(userId);
    const propio = agregarMensaje(userId, conv, { de: 'yo', texto: '🎤 Nota de voz', tipo: 'audio' });
    const message = {
      message_id: propio.id,
      date: Math.floor(propio.ts / 1000),
      chat: chatDe(userId, nombre),
      from: usuarioTelegram(userId, nombre),
      voice: {
        file_id: fileId,
        file_unique_id: fileId,
        duration: Math.max(0, Math.round(Number(duracion) || 0)),
        mime_type: mimeType,
        file_size: buffer.length,
      },
    };
    await correrUpdate(userId, { update_id: ++ultimoUpdateId, message }, telegram);
    return snapshot(userId, avisos);
  });
}

// Foto o PDF (factura, ticket, transferencia, agenda). Llega como un `document`
// de Telegram: lo recibe photo.js igual que si lo mandaran desde Telegram
// (clasifica, lee con Gemini y pide confirmación). El texto que el usuario
// escribió junto al archivo viaja como `caption`, que photo.js usa como pista.
async function enviarArchivo(userId, { buffer, mimeType, nombre, caption }, { nombre: nombreUsuario } = {}) {
  return enCola(userId, async () => {
    await asegurarCargada(userId);
    const avisos = [];
    const telegram = new TelegramWeb(userId, avisos);
    const fileId = `${PREFIJO_ARCHIVO_WEB}${crypto.randomUUID()}`;
    telegram.archivos.set(fileId, { buffer, mimeType });
    const conv = conversacionDe(userId);
    const esPdf = mimeType === 'application/pdf';
    const etiqueta = `${esPdf ? '📄' : '📷'} ${nombre || (esPdf ? 'Documento' : 'Foto')}`;
    const limpio = String(caption || '').trim();
    const propio = agregarMensaje(userId, conv, {
      de: 'yo',
      texto: limpio ? `${etiqueta}\n${limpio}` : etiqueta,
      tipo: 'archivo',
    });
    const message = {
      message_id: propio.id,
      date: Math.floor(propio.ts / 1000),
      chat: chatDe(userId, nombreUsuario),
      from: usuarioTelegram(userId, nombreUsuario),
      document: {
        file_id: fileId,
        file_unique_id: fileId,
        file_name: nombre || undefined,
        mime_type: mimeType,
        file_size: buffer.length,
      },
    };
    if (limpio) message.caption = limpio;
    await correrUpdate(userId, { update_id: ++ultimoUpdateId, message }, telegram);
    return snapshot(userId, avisos);
  });
}

// Un botón solo se puede "apretar" si está en un mensaje del bot de esta
// conversación: Telegram nunca manda callback_data que no venga de un botón
// real, y los handlers confían en eso.
async function apretarBoton(userId, mensajeId, data, { nombre } = {}) {
  return enCola(userId, async () => {
    await asegurarCargada(userId);
    const conv = conversacionDe(userId);
    const mensaje = buscarMensaje(conv, mensajeId);
    const valido = mensaje && mensaje.de === 'bot' &&
      mensaje.botones.some(fila => fila.some(b => b.data === data));
    if (!valido) {
      return { ...snapshot(userId, ['Ese botón ya no está disponible.']), invalido: true };
    }
    const avisos = [];
    const telegram = new TelegramWeb(userId, avisos);
    const update = {
      update_id: ++ultimoUpdateId,
      callback_query: {
        id: `web-${crypto.randomUUID()}`,
        from: usuarioTelegram(userId, nombre),
        message: { ...mensajeTelegram(Number(userId), mensaje), chat: chatDe(userId, nombre) },
        chat_instance: `web-${userId}`,
        data,
      },
    };
    await correrUpdate(userId, update, telegram);
    return snapshot(userId, avisos);
  });
}

function _resetParaTests() {
  for (const conv of conversaciones.values()) clearTimeout(conv.timerGuardado);
  conversaciones.clear();
  guardadosEnCurso.clear();
}

module.exports = {
  obtenerConversacion,
  enviarTexto,
  enviarAudio,
  enviarArchivo,
  apretarBoton,
  vaciarGuardados,
  EPOCA,
  MAX_MENSAJES,
  _resetParaTests,
};
