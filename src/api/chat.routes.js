// Chat del dashboard: mismo bot que Telegram, servido por la web.
// Toda la lógica (reglas, NLP, confirmaciones, permisos por invitado, rate
// limit, cuota de IA) la aplica el pipeline del bot en src/lib/canal-web.js;
// estas rutas solo validan la forma del pedido y le pasan el userId de la
// sesión del dashboard (que es el mismo ID de Telegram del usuario).

const express = require('express');
const config = require('../config');
const logger = require('../lib/logger');

const MAX_TEXTO_CHAT = 4000;
const MAX_AUDIO_BYTES = config.MAX_VOICE_SIZE_BYTES || 5 * 1024 * 1024;

// Lo que graban los navegadores: Chrome/Android y Firefox (webm/ogg con opus),
// Safari/iPhone (mp4 con AAC). Gemini recibe el MIME tal cual.
const MIME_AUDIO = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a'];
const subidaAudio = express.raw({ type: MIME_AUDIO, limit: MAX_AUDIO_BYTES });

// Fotos y PDFs: los mismos tipos y el mismo tope que el resto de los comprobantes.
const MIME_ARCHIVO = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_ARCHIVO_BYTES = config.MAX_PHOTO_SIZE_BYTES || 10 * 1024 * 1024;
const subidaArchivo = express.raw({ type: MIME_ARCHIVO, limit: MAX_ARCHIVO_BYTES });
const MAX_CAPTION = 200;
const MAX_NOMBRE = 80;

function registrarRutasChat(app, { authMiddleware }) {
  const canalWeb = require('../lib/canal-web');

  app.get('/api/chat', authMiddleware, (req, res) => {
    res.json(canalWeb.obtenerConversacion(req.user.userId));
  });

  app.post('/api/chat/mensaje', authMiddleware, async (req, res) => {
    const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
    if (!texto) return res.status(400).json({ error: 'El mensaje está vacío' });
    if (texto.length > MAX_TEXTO_CHAT) return res.status(400).json({ error: 'El mensaje es demasiado largo' });
    try {
      res.json(await canalWeb.enviarTexto(req.user.userId, texto));
    } catch (err) {
      logger.error('CHAT_WEB', 'Error POST /api/chat/mensaje', { err: err.message });
      res.status(500).json({ error: 'No se pudo procesar el mensaje' });
    }
  });

  app.post('/api/chat/audio', authMiddleware, subidaAudio, async (req, res) => {
    const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!MIME_AUDIO.includes(mimeType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Mandá un audio grabado desde el chat' });
    }
    const duracion = Number(req.query.duracion) || 0;
    try {
      res.json(await canalWeb.enviarAudio(req.user.userId, { buffer: req.body, mimeType, duracion }));
    } catch (err) {
      logger.error('CHAT_WEB', 'Error POST /api/chat/audio', { err: err.message });
      res.status(500).json({ error: 'No se pudo procesar el audio' });
    }
  });

  app.post('/api/chat/archivo', authMiddleware, subidaArchivo, async (req, res) => {
    const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!MIME_ARCHIVO.includes(mimeType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Mandá una foto (JPG, PNG, WEBP) o un PDF' });
    }
    // Sin barras ni saltos de línea: el nombre solo se muestra en el chat.
    const nombre = String(req.query.nombre || '').replace(/[\\/\r\n]/g, ' ').trim().slice(0, MAX_NOMBRE);
    const caption = String(req.query.caption || '').replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_CAPTION);
    try {
      res.json(await canalWeb.enviarArchivo(req.user.userId, { buffer: req.body, mimeType, nombre, caption }));
    } catch (err) {
      logger.error('CHAT_WEB', 'Error POST /api/chat/archivo', { err: err.message });
      res.status(500).json({ error: 'No se pudo procesar el archivo' });
    }
  });

  app.post('/api/chat/boton', authMiddleware, async (req, res) => {
    const mensajeId = Number(req.body?.mensajeId);
    const data = typeof req.body?.data === 'string' ? req.body.data : '';
    if (!Number.isInteger(mensajeId) || mensajeId <= 0 || !data || data.length > 64) {
      return res.status(400).json({ error: 'Botón inválido' });
    }
    try {
      const resultado = await canalWeb.apretarBoton(req.user.userId, mensajeId, data);
      res.status(resultado.invalido ? 409 : 200).json(resultado);
    } catch (err) {
      logger.error('CHAT_WEB', 'Error POST /api/chat/boton', { err: err.message });
      res.status(500).json({ error: 'No se pudo procesar el botón' });
    }
  });
}

module.exports = { registrarRutasChat, MIME_AUDIO, MIME_ARCHIVO };
