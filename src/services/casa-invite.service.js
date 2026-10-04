// Invitaciones a una CASA compartida. Códigos de un solo uso, en memoria,
// vigencia 24 h (como los de consultorio, se pierden si el proceso reinicia).
//
// Viven aparte de state.pendingCodigos: ese mapa invita a un CONSULTORIO (el
// invitado comparte el sheet del dueño); acá el invitado conserva su cuenta y
// su sheet, y solo se suma a la casa.

const { MAX_INTENTOS_CODIGO } = require('../config');
const { getIntentosCodigo, incrementIntentosCodigo, resetIntentosCodigo } = require('../auth');
const state = require('../state');
const { generateInviteCode } = require('./invite.service');

function crearInvitacionCasa({ ownerId, casaId, casaNombre, miembroId = null, creadoPor }) {
  let codigo;
  do {
    codigo = generateInviteCode();
  } while (state.pendingInvitacionesCasa.has(codigo) || state.pendingCodigos.has(codigo));

  state.pendingInvitacionesCasa.set(codigo, {
    ownerId: String(ownerId),
    casaId,
    casaNombre,
    miembroId,
    creadoPor: String(creadoPor),
    createdAt: Date.now(),
  });
  return codigo;
}

/**
 * ¿Es un código de casa? No consume ni cuenta intentos si lo es; sí cuenta uno
 * si no lo es y el usuario ya tiene cuenta (el flujo de consultorio no llega a
 * contarlo para ellos), para que no se pueda adivinar códigos sin límite.
 * @returns {{estado:'casa', codigo, data} | {estado:'otro'} | {estado:'bloqueado'}}
 */
function buscarInvitacionCasa(userId, rawCode, { tieneCuenta = false } = {}) {
  if (getIntentosCodigo(userId) >= MAX_INTENTOS_CODIGO) return { estado: 'bloqueado' };

  const codigo = String(rawCode || '').trim().toUpperCase();
  const data = state.pendingInvitacionesCasa.get(codigo);
  if (data) return { estado: 'casa', codigo, data };

  if (tieneCuenta) incrementIntentosCodigo(userId);
  return { estado: 'otro' };
}

function consumirInvitacionCasa(userId, codigo) {
  state.pendingInvitacionesCasa.delete(codigo);
  resetIntentosCodigo(userId);
}

module.exports = { crearInvitacionCasa, buscarInvitacionCasa, consumirInvitacionCasa };
