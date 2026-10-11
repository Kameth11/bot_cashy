// Invitaciones por email desde el dashboard (alta sin Telegram). Toda la lógica y las reglas de
// seguridad están en src/services/invitacion-web.service.js; acá solo se valida la forma del pedido
// y se traducen los códigos de error. Quién invita sale SIEMPRE de la sesión (req.user.userId).
//
// Para entrar: la persona invitada abre el dashboard y usa "Entrar con Google" con ese email
// (ver POST /api/auth/google en src/api/index.js, que canjea la invitación).

const logger = require('../lib/logger');
const { resolverPermisos } = require('../auth');
const { puede, PERMISOS, PRESETS } = require('../auth/permisos');

const MENSAJES = {
  sin_base: 'Las invitaciones necesitan la base de datos (Supabase), que no está disponible.',
  sin_permiso: 'No tenés permiso para invitar personas',
  email_invalido: 'Escribí un email válido',
  permisos_invalidos: 'Los permisos elegidos no son válidos',
  permisos_excedidos: 'No podés dar permisos que vos no tenés',
  delegacion_no_permitida: 'Solo el dueño puede dar el permiso de invitar a otras personas',
  limite_pendientes: 'Hay demasiadas invitaciones pendientes. Revocá alguna o esperá a que venzan',
  ya_miembro: 'Esa persona ya forma parte del consultorio',
  ya_invitado: 'Ya hay una invitación pendiente para ese email',
  profesional_nombre_invalido: 'Escribí el nombre del profesional (al menos 2 letras)',
  profesional_duplicado: 'Ya hay un profesional registrado con ese nombre',
  no_encontrada: 'La invitación no existe, ya se usó o ya no se puede revocar',
};

const ESTADO = {
  sin_base: 503,
  sin_permiso: 403,
  email_invalido: 400,
  permisos_invalidos: 400,
  permisos_excedidos: 403,
  delegacion_no_permitida: 403,
  limite_pendientes: 409,
  ya_miembro: 409,
  ya_invitado: 409,
  profesional_nombre_invalido: 400,
  profesional_duplicado: 409,
  no_encontrada: 404,
};

function responderError(res, error) {
  if (MENSAJES[error]) return res.status(ESTADO[error] || 400).json({ error: MENSAJES[error] });
  return res.status(500).json({ error: 'No se pudo completar la operación' });
}

function registrarRutasInvitaciones(app, { authMiddleware, requierePermiso, rateLimit, limitador, esDuenoOAdmin, dashboardUrl }) {
  const invitaciones = require('../services/invitacion-web.service');

  // Qué permisos puede dar quien mira: los suyos (el dueño, todos), sin el de invitar salvo que sea el dueño.
  function permisosQuePuedeDar(userId) {
    const propios = resolverPermisos(userId);
    const dueno = esDuenoOAdmin(userId);
    return PERMISOS.filter(p => (dueno ? true : puede(propios, p) && p !== invitaciones.PERMISO_INVITAR));
  }

  app.get('/api/invitaciones', authMiddleware, requierePermiso(invitaciones.PERMISO_INVITAR), async (req, res) => {
    try {
      const r = await invitaciones.listarInvitaciones(req.user.userId);
      if (!r.ok) return responderError(res, r.error);
      const permisosDisponibles = permisosQuePuedeDar(req.user.userId);
      // Plantillas rápidas, solo las que quien invita puede dar completas.
      const presets = Object.fromEntries(Object.entries(PRESETS).filter(([, lista]) => lista.every(p => permisosDisponibles.includes(p))));
      res.json({
        invitaciones: r.invitaciones,
        permisosDisponibles,
        presets,
        puedeDelegar: esDuenoOAdmin(req.user.userId),
        vigenciaDias: invitaciones.DIAS_DE_VIGENCIA,
        urlIngreso: dashboardUrl() || null,
      });
    } catch (err) {
      logger.error('INVITACION', 'Error GET /api/invitaciones', { err: err.message });
      res.status(500).json({ error: 'No se pudieron leer las invitaciones' });
    }
  });

  app.post('/api/invitaciones',
    authMiddleware,
    requierePermiso(invitaciones.PERMISO_INVITAR),
    rateLimit(limitador, req => String(req.user.userId)),
    async (req, res) => {
      try {
        const body = req.body || {};
        const r = await invitaciones.crearInvitacion(req.user.userId, {
          email: body.email,
          permisos: body.permisos,
          profesional: body.profesional,
        });
        if (!r.ok) return responderError(res, r.error);
        res.status(201).json({ ok: true, invitacion: r.invitacion, urlIngreso: dashboardUrl() || null });
      } catch (err) {
        logger.error('INVITACION', 'Error POST /api/invitaciones', { err: err.message });
        res.status(500).json({ error: 'No se pudo crear la invitación' });
      }
    });

  app.delete('/api/invitaciones/:id', authMiddleware, requierePermiso(invitaciones.PERMISO_INVITAR), async (req, res) => {
    try {
      const r = await invitaciones.revocarInvitacion(req.user.userId, req.params.id);
      if (!r.ok) return responderError(res, r.error);
      res.json({ ok: true });
    } catch (err) {
      logger.error('INVITACION', 'Error DELETE /api/invitaciones', { err: err.message });
      res.status(500).json({ error: 'No se pudo revocar la invitación' });
    }
  });
}

module.exports = { registrarRutasInvitaciones };
