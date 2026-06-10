const { AUTHORIZED_USER_ID, ALLOWED_EMAILS, CODIGO_EXPIRACION_HORAS } = require('../config');
const clienteService = require('../services/cliente.service');
const state = require('../state');

const CODIGO_EXPIRACION_MS = CODIGO_EXPIRACION_HORAS * 60 * 60 * 1000;

function esAdminOriginal(userId) {
  // Coerce a número: el JWT guarda string, el config tiene int
  return AUTHORIZED_USER_ID && Number(userId) === AUTHORIZED_USER_ID;
}

function esEmailAutorizado(email) {
  if (!email) return false;
  return ALLOWED_EMAILS.includes(email.toLowerCase().trim());
}

function obtenerClientePorUserId(userId) {
  const clientes = clienteService.clientes;
  const numId = Number(userId);
  const strId = String(userId);
  for (const [ownerId, cliente] of Object.entries(clientes)) {
    if (parseInt(ownerId) === numId) return { userId: ownerId, ownerId: ownerId, isOwner: true, ...cliente };
    if (cliente.usuarios && (cliente.usuarios.includes(strId) || cliente.usuarios.includes(numId))) {
      return { userId: ownerId, ownerId: ownerId, isOwner: false, ...cliente };
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

function getIntentosCodigo(userId) {
  return state.pendingIntentosCodigo.get(userId) || 0;
}

function incrementIntentosCodigo(userId) {
  const actuales = getIntentosCodigo(userId);
  state.pendingIntentosCodigo.set(userId, actuales + 1);
  return actuales + 1;
}

function resetIntentosCodigo(userId) {
  state.pendingIntentosCodigo.delete(userId);
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
  getIntentosCodigo,
  incrementIntentosCodigo,
  resetIntentosCodigo,
  codigoInvitacionExpirado,
};
