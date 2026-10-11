// Registro de profesionales desde el dashboard (el equivalente web de /profesional).
//
// Un "profesional" es una persona del consultorio (con cuenta: Telegram/dashboard) que atiende
// turnos. Registrado, recibe los avisos de sus turnos (llegada, turno nuevo, cancelado...) por
// Telegram y por la campanita/push de la web, y el bot puede asignarle los turnos al leer una
// foto de la agenda según su consultorio. Vive en la tabla `profesionales` de Supabase.
//
// Permisos: cada persona gestiona SU registro; el dueño del consultorio gestiona el de
// cualquiera de sus miembros (él mismo y sus invitados). Nunca se toca a alguien de otro consultorio.

const logger = require('../lib/logger');
const { isAvailable } = require('../lib/supabase');
const { sanitizarInput } = require('../utils/formatter');

const NOMBRE_MIN = 2;
const NOMBRE_MAX = 60;
const CONSULTORIO_MAX = 40;

function registrarRutasProfesionales(app, { authMiddleware, esDuenoOAdmin, clientes, resolveTenantId }) {
  const profesionales = require('../services/profesional.service');
  const agenda = require('../services/agenda.service');

  const SIN_BASE = 'El registro de profesionales necesita la base de datos (Supabase), que no está disponible.';

  // Miembros del consultorio del dueño: él mismo y sus invitados.
  function miembrosDelDueno(ownerKey) {
    const owner = clientes()[ownerKey];
    return [ownerKey, ...((owner?.usuarios || []).map(String))];
  }

  const etiqueta = (id, esYo) => (esYo ? 'Vos' : `Usuario …${String(id).slice(-4)}`);

  // Resuelve a quién se refiere el pedido y si quien lo hace puede tocarlo.
  // -> { objetivo } o { status, error }
  function resolverObjetivo(req) {
    const actor = String(req.user.userId);
    const objetivo = req.params.userId === 'yo' ? actor : String(req.params.userId);
    if (objetivo === actor) return { actor, objetivo };
    if (!esDuenoOAdmin(actor)) return { status: 403, error: 'Solo el dueño del consultorio puede registrar a otras personas' };
    if (!miembrosDelDueno(actor).includes(objetivo)) return { status: 404, error: 'Esa persona no es miembro de este consultorio' };
    return { actor, objetivo };
  }

  // Estado del registro: la lista de personas que el pedido puede gestionar y quién ya es profesional.
  app.get('/api/profesionales/registro', authMiddleware, async (req, res) => {
    try {
      if (!isAvailable()) return res.status(503).json({ error: SIN_BASE });
      const actor = String(req.user.userId);
      const tenantId = await resolveTenantId(actor);
      if (!tenantId) return res.status(503).json({ error: SIN_BASE });

      const registrados = await profesionales.listarProfesionales(tenantId);
      const porUsuario = new Map(registrados.map(p => [p.userId, p]));
      const dueno = esDuenoOAdmin(actor);

      // El dueño ve a todos sus miembros (registrados o no) y a quien esté registrado aunque ya no sea
      // miembro (p. ej. se lo registró por el bot); los demás, solo a sí mismos.
      const ids = dueno
        ? [...new Set([...miembrosDelDueno(actor), ...registrados.map(p => p.userId)])]
        : [actor];

      const miembros = ids.map(id => ({
        userId: id,
        esYo: id === actor,
        etiqueta: etiqueta(id, id === actor),
        profesional: porUsuario.has(id) ? { nombre: porUsuario.get(id).nombre, consultorio: porUsuario.get(id).consultorio } : null,
      }));
      // Primero yo, después los registrados, después el resto.
      miembros.sort((a, b) => (b.esYo - a.esYo) || (Boolean(b.profesional) - Boolean(a.profesional)));

      res.json({ puedeGestionar: dueno, miembros });
    } catch (err) {
      logger.error('API', 'Error GET /api/profesionales/registro', { err: err.message });
      res.status(500).json({ error: 'No se pudo leer el registro de profesionales' });
    }
  });

  // Alta o cambio. `:userId` es 'yo' o el id de un miembro (solo el dueño).
  app.put('/api/profesionales/registro/:userId', authMiddleware, async (req, res) => {
    try {
      const quien = resolverObjetivo(req);
      if (quien.error) return res.status(quien.status).json({ error: quien.error });
      if (!isAvailable()) return res.status(503).json({ error: SIN_BASE });

      const nombre = sanitizarInput(req.body?.nombre, NOMBRE_MAX).trim();
      if (nombre.length < NOMBRE_MIN) return res.status(400).json({ error: `Escribí el nombre (al menos ${NOMBRE_MIN} letras)` });
      // "ninguno" / "-" se reconocen ANTES de sanitizar: el sanitizador antepone un apóstrofo a los
      // textos que empiezan con "-" (anti inyección de fórmulas) y ya no coincidirían.
      const crudo = String(req.body?.consultorio ?? '').trim();
      const consultorio = !crudo || /^(ninguno|no|-)$/i.test(crudo) ? null : (sanitizarInput(crudo, CONSULTORIO_MAX).trim() || null);

      const tenantId = await resolveTenantId(quien.actor);
      if (!tenantId) return res.status(503).json({ error: SIN_BASE });

      // Dos profesionales con el mismo nombre harían que el aviso le llegue a quien no es.
      const normal = profesionales.normalizarNombreProfesional(nombre);
      const existentes = await profesionales.listarProfesionales(tenantId);
      if (existentes.some(p => p.userId !== quien.objetivo && profesionales.normalizarNombreProfesional(p.nombre) === normal)) {
        return res.status(409).json({ error: 'Ya hay un profesional registrado con ese nombre' });
      }

      const resultado = await profesionales.registrarProfesional(tenantId, quien.objetivo, nombre, consultorio);
      if (!resultado.ok) {
        logger.error('API', 'No se pudo registrar al profesional', { err: resultado.error });
        return res.status(500).json({ error: 'No se pudo guardar el profesional' });
      }
      agenda.invalidarConsultorioMap(tenantId);
      logger.audit('profesional_registrado', { actor: quien.actor, objetivo: quien.objetivo, consultorio, origen: 'dashboard' });
      res.json({ ok: true, profesional: { userId: quien.objetivo, nombre, consultorio } });
    } catch (err) {
      logger.error('API', 'Error PUT /api/profesionales/registro', { err: err.message });
      res.status(500).json({ error: 'No se pudo guardar el profesional' });
    }
  });

  app.delete('/api/profesionales/registro/:userId', authMiddleware, async (req, res) => {
    try {
      const quien = resolverObjetivo(req);
      if (quien.error) return res.status(quien.status).json({ error: quien.error });
      if (!isAvailable()) return res.status(503).json({ error: SIN_BASE });

      const tenantId = await resolveTenantId(quien.actor);
      if (!tenantId) return res.status(503).json({ error: SIN_BASE });

      const resultado = await profesionales.eliminarProfesional(tenantId, quien.objetivo);
      if (!resultado.ok) {
        logger.error('API', 'No se pudo dar de baja al profesional', { err: resultado.error });
        return res.status(500).json({ error: 'No se pudo dar de baja al profesional' });
      }
      agenda.invalidarConsultorioMap(tenantId);
      logger.audit('profesional_baja', { actor: quien.actor, objetivo: quien.objetivo, origen: 'dashboard' });
      res.json({ ok: true });
    } catch (err) {
      logger.error('API', 'Error DELETE /api/profesionales/registro', { err: err.message });
      res.status(500).json({ error: 'No se pudo dar de baja al profesional' });
    }
  });
}

module.exports = { registrarRutasProfesionales };
