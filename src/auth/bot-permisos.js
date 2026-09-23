// Mecanismo central de permisos granulares para el bot de Telegram.
// Espejo de requierePermiso/ownerOnly de src/api/index.js: misma fuente de
// verdad (resolverPermisos), mismo criterio de auditoría.

const { resolverPermisos, esAdminOriginal, obtenerClientePorUserId } = require('./index');
const logger = require('../lib/logger');

const MENSAJE_SIN_PERMISO = '🔒 No tenés permiso para hacer esto. Si creés que deberías tenerlo, pedile al dueño de la cuenta que te lo habilite.';
const MENSAJE_SOLO_DUENO = '🔒 Este comando es solo para el dueño de la cuenta.';

function tienePermisoBot(userId, permiso) {
  return resolverPermisos(userId).includes(permiso);
}

function esDuenoBot(userId) {
  if (esAdminOriginal(userId)) return true;
  const cliente = obtenerClientePorUserId(userId);
  return !!(cliente && cliente.isOwner);
}

// Devuelve true si el usuario puede continuar. Si no, ya respondió al
// usuario y registró la auditoría — el caller solo tiene que hacer
// `if (!requierePermisoBot(...)) return;`.
function requierePermisoBot(ctx, permiso, comando) {
  const userId = ctx.from?.id;
  if (tienePermisoBot(userId, permiso)) return true;

  logger.audit('permiso_denegado', { userId, permiso, comando, canal: 'bot' });
  ctx.reply(MENSAJE_SIN_PERMISO).catch(() => {});
  return false;
}

function requiereDuenoBot(ctx, comando) {
  const userId = ctx.from?.id;
  if (esDuenoBot(userId)) return true;

  logger.audit('permiso_denegado', { userId, permiso: 'dueño_o_admin', comando, canal: 'bot' });
  ctx.reply(MENSAJE_SOLO_DUENO).catch(() => {});
  return false;
}

module.exports = { tienePermisoBot, esDuenoBot, requierePermisoBot, requiereDuenoBot };
