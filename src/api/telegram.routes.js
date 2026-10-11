// Vincular Telegram desde el dashboard: para cuentas nacidas en la web (invitación por email), que no
// tienen Telegram. La lógica del bot está en src/handlers/vinculo-telegram.js; acá solo se pide el
// vínculo, se consulta si ya se hizo y se quita. La cuenta sale SIEMPRE de la sesión (req.user.userId).

const clienteService = require('../services/cliente.service');
const vinculo = require('../services/vinculo-telegram.service');
const logger = require('../lib/logger');

function registrarRutasTelegram(app, { authMiddleware, rateLimit, limitador, obtenerUsernameBot }) {
  const estadoDe = (userId) => {
    const id = String(userId);
    const aplica = Number(id) < 0; // las cuentas de Telegram (ID positivo) ya SON su Telegram
    return {
      aplica,
      vinculado: aplica && Boolean(clienteService.clientes[id]?.telegramId),
      soportado: clienteService.telegramVinculoSoportado(),
    };
  };

  app.get('/api/telegram/estado', authMiddleware, (req, res) => {
    res.json(estadoDe(req.user.userId));
  });

  // Crea el pedido y devuelve el enlace que abre el bot con la confirmación.
  app.post('/api/telegram/vincular',
    authMiddleware,
    rateLimit(limitador, req => String(req.user.userId)),
    async (req, res) => {
      try {
        const id = String(req.user.userId);
        const estado = estadoDe(id);
        if (!estado.aplica) return res.status(400).json({ error: 'Tu cuenta ya es de Telegram: no hace falta vincular nada' });
        if (estado.vinculado) return res.status(409).json({ error: 'Tu cuenta ya tiene un Telegram vinculado' });
        if (!estado.soportado) return res.status(503).json({ error: 'Vincular Telegram todavía no está habilitado en el servidor (falta correr la migración 022)' });
        if (!clienteService.clientes[id]) return res.status(404).json({ error: 'No se encontró tu cuenta' });

        const username = await obtenerUsernameBot().catch(() => null);
        if (!username) return res.status(503).json({ error: 'No se pudo preparar el enlace al bot. Probá de nuevo en un rato' });

        const pedido = vinculo.crearPedido(id);
        logger.audit('telegram_vinculo_solicitado', { userId: id, ip: req.ip });
        res.json({ deepLink: `https://t.me/${username}?start=vincular_${pedido.token}`, expiraEnSeg: pedido.expiraEnSeg });
      } catch (err) {
        logger.error('API', 'Error POST /api/telegram/vincular', { err: err.message });
        res.status(500).json({ error: 'No se pudo preparar el vínculo con Telegram' });
      }
    });

  app.delete('/api/telegram/vincular', authMiddleware, async (req, res) => {
    try {
      const id = String(req.user.userId);
      const estado = estadoDe(id);
      if (!estado.aplica || !estado.vinculado) return res.status(400).json({ error: 'No hay un Telegram vinculado para quitar' });
      await clienteService.desvincularTelegram(id);
      logger.audit('telegram_desvinculado', { userId: id });
      res.json({ ok: true });
    } catch (err) {
      logger.error('API', 'Error DELETE /api/telegram/vincular', { err: err.message });
      res.status(500).json({ error: 'No se pudo desvincular Telegram' });
    }
  });
}

module.exports = { registrarRutasTelegram };
