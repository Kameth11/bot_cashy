// Notificaciones web del dashboard (campanita + Web Push). Cada persona ve y toca
// SOLO las suyas: el userId sale siempre de la sesión (req.user.userId), nunca del pedido.
// La lógica está en src/services/notificaciones.service.js.

const logger = require('../lib/logger');

function registrarRutasNotificaciones(app, { authMiddleware }) {
  const notificaciones = require('../services/notificaciones.service');

  // Lista de la campanita + si este servidor puede mandar push (y con qué clave pública
  // se suscribe el navegador).
  app.get('/api/notificaciones', authMiddleware, async (req, res) => {
    try {
      const { notificaciones: lista, noLeidas } = await notificaciones.listar(req.user.userId);
      res.json({ notificaciones: lista, noLeidas, push: { disponible: notificaciones.pushDisponible(), clavePublica: notificaciones.clavePublica(), motivo: notificaciones.motivoSinPush() } });
    } catch (err) {
      logger.error('NOTIF', 'Error GET /api/notificaciones', { err: err.message });
      res.status(500).json({ error: 'No se pudieron leer las notificaciones' });
    }
  });

  app.post('/api/notificaciones/leidas', authMiddleware, async (req, res) => {
    try {
      await notificaciones.marcarLeidas(req.user.userId);
      res.json({ ok: true });
    } catch (err) {
      logger.error('NOTIF', 'Error POST /api/notificaciones/leidas', { err: err.message });
      res.status(500).json({ error: 'No se pudieron marcar como leídas' });
    }
  });

  // El navegador manda la suscripción que le dio PushManager.subscribe().
  app.post('/api/notificaciones/suscripcion', authMiddleware, async (req, res) => {
    if (!notificaciones.pushDisponible()) return res.status(503).json({ error: 'Los avisos con la web cerrada no están configurados en el servidor' });
    try {
      await notificaciones.guardarSuscripcion(req.user.userId, req.body?.suscripcion, req.get('user-agent') || '');
      res.status(201).json({ ok: true });
    } catch (err) {
      if (err.message === 'suscripcion_invalida') return res.status(400).json({ error: 'La suscripción es inválida' });
      logger.error('NOTIF', 'Error POST /api/notificaciones/suscripcion', { err: err.message });
      res.status(500).json({ error: 'No se pudo activar el aviso en este dispositivo' });
    }
  });

  app.delete('/api/notificaciones/suscripcion', authMiddleware, async (req, res) => {
    try {
      await notificaciones.borrarSuscripcion(req.user.userId, req.body?.endpoint);
      res.json({ ok: true });
    } catch (err) {
      logger.error('NOTIF', 'Error DELETE /api/notificaciones/suscripcion', { err: err.message });
      res.status(500).json({ error: 'No se pudo desactivar el aviso en este dispositivo' });
    }
  });
}

module.exports = { registrarRutasNotificaciones };
