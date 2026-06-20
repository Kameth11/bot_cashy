const { CODIGO_EXPIRACION_HORAS, MAX_INTENTOS_CODIGO, GOOGLE_SERVICE_ACCOUNT_EMAIL } = require('../config');
const {
  obtenerClientePorUserId,
  codigoInvitacionExpirado,
  getIntentosCodigo,
  incrementIntentosCodigo,
  resetIntentosCodigo,
} = require('../auth');
const clienteService = require('./cliente.service');
const state = require('../state');

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function buildInviteCodeMessage(codigo) {
  return (
    `🔑 *Código de invitación*\n\n` +
    `Comparte este código (vigencia ${CODIGO_EXPIRACION_HORAS}h):\n\n` +
    `*${codigo}*\n\n` +
    `La persona debe enviar:\n` +
    `\`/unir ${codigo}\``
  );
}

function createInviteCode(ownerId) {
  const codigo = generateInviteCode();
  state.pendingCodigos.set(codigo, {
    ownerId,
    createdAt: Date.now()
  });
  return codigo;
}

function resolveInviteCode(userId, rawCode) {
  const intentos = getIntentosCodigo(userId);
  if (intentos >= MAX_INTENTOS_CODIGO) {
    return { ok: false, codigo: null, message: '❌ Demasiados intentos con códigos inválidos. Pedí uno nuevo al owner y probá de nuevo más tarde.' };
  }

  const codigo = String(rawCode || '').trim().toUpperCase();
  const codigoData = state.pendingCodigos.get(codigo);

  if (!codigoData) {
    incrementIntentosCodigo(userId);
    return { ok: false, codigo, message: '❌ Código inválido o expirado. Pide uno nuevo al owner.' };
  }

  if (codigoInvitacionExpirado(codigoData)) {
    state.pendingCodigos.delete(codigo);
    incrementIntentosCodigo(userId);
    return { ok: false, codigo, message: '❌ Código expirado. Pide uno nuevo al owner.' };
  }

  const ownerId = codigoData.ownerId;
  const clientes = clienteService.clientes;
  if (!clientes[ownerId]) {
    state.pendingCodigos.delete(codigo);
    incrementIntentosCodigo(userId);
    return { ok: false, codigo, message: '❌ El owner ya no existe.' };
  }

  resetIntentosCodigo(userId);
  return { ok: true, codigo, ownerId, clientes, codigoData };
}

// Camino público único de invitación: el invitado valida el código y queda
// con su PROPIO Google Sheet aislado (no comparte el del owner). Valida el
// código y arranca el flujo de alta de sheet (paso `sheetId`), que termina
// de configurarse en registration.service.handleSheetIdStep.
async function beginInviteRegistration(userId, rawCode) {
  if (obtenerClientePorUserId(userId)) {
    return { message: '⚠️ Ya tienes una cuenta registrada. Habla con el owner si necesitas agregar otro usuario.' };
  }

  const resolved = resolveInviteCode(userId, rawCode);
  if (!resolved.ok) {
    return { message: resolved.message };
  }

  const { codigo, ownerId, clientes } = resolved;

  if (!clientes[ownerId].usuarios) {
    clientes[ownerId].usuarios = [];
  }

  if (clientes[ownerId].usuarios.includes(userId)) {
    state.pendingRegistros.delete(userId);
    return { message: '⚠️ Ya estás autorizado.' };
  }

  state.pendingRegistros.set(userId, {
    step: 'sheetId',
    ownerId,
    codigo
  });
  state.pendingCodigos.delete(codigo);

  return {
    message:
      '✅ *Código válido!*\n\n' +
      'Ahora configura tu propio Google Sheet (cada usuario tiene el suyo).\n\n' +
      '📊 *Paso 1:* Compártelo con mi service account:\n\n' +
      `📧 *Email:* ${GOOGLE_SERVICE_ACCOUNT_EMAIL}\n\n` +
      'Dale permisos de "Editor" y luego ingresa el ID de tu spreadsheet:\n' +
      'Ejemplo: `1abc123def456GHI789jkl012`\n\n' +
      'Usa /cancelar para salir.',
    parse_mode: 'Markdown'
  };
}

module.exports = {
  generateInviteCode,
  buildInviteCodeMessage,
  createInviteCode,
  beginInviteRegistration,
};
