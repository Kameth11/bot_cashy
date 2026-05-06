const { AUTHORIZED_USER_ID, ALLOWED_EMAILS, CODIGO_EXPIRACION_HORAS } = require('../config');
const clienteService = require('../services/cliente.service');
const state = require('../state');

const CODIGO_EXPIRACION_MS = CODIGO_EXPIRACION_HORAS * 60 * 60 * 1000;

function esAdminOriginal(userId) {
  return AUTHORIZED_USER_ID && userId === AUTHORIZED_USER_ID;
}

function esEmailAutorizado(email) {
  if (!email) return false;
  return ALLOWED_EMAILS.includes(email.toLowerCase().trim());
}

function obtenerClientePorUserId(userId) {
  const clientes = clienteService.clientes;
  for (const [ownerId, cliente] of Object.entries(clientes)) {
    if (parseInt(ownerId) === userId) return { userId: ownerId, ownerId: null, ...cliente };
    if (cliente.usuarios && cliente.usuarios.includes(userId)) {
      return { userId: ownerId, ownerId: ownerId, ...cliente };
    }
  }
  return null;
}

function getIntentosEmail(userId) {
  return state.pendingIntentosEmail.get(userId) || 0;
}

function incrementIntentosEmail(userId) {
  const actuales = getIntentosEmail(userId);
  state.pendingIntentosEmail.set(userId, actuales + 1);
  return actuales + 1;
}

function resetIntentosEmail(userId) {
  state.pendingIntentosEmail.delete(userId);
}

function codigoInvitacionExpirado(codigoData) {
  if (!codigoData || !codigoData.createdAt) return false;
  return Date.now() - codigoData.createdAt > CODIGO_EXPIRACION_MS;
}

module.exports = {
  esAdminOriginal,
  esEmailAutorizado,
  obtenerClientePorUserId,
  getIntentosEmail,
  incrementIntentosEmail,
  resetIntentosEmail,
  codigoInvitacionExpirado,
};
