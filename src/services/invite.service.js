const { CODIGO_EXPIRACION_HORAS, GOOGLE_SERVICE_ACCOUNT_EMAIL, MAX_INTENTOS_CODIGO } = require('../config');
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
    `La persona debe usar /start y luego ingresar el código.`
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

async function joinWithInviteCode(userId, rawCode) {
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
    return { message: '⚠️ Ya estás autorizado en esta cuenta.' };
  }

  clientes[ownerId].usuarios.push(userId);
  await clienteService.guardarClientes(clientes);
  state.pendingCodigos.delete(codigo);

  return {
    message:
      `✅ *¡Te uniste correctamente!*\n\n` +
      `Ahora puedes usar el bot con la cuenta del owner.\n` +
      `Usa /start para ver los comandos disponibles.`,
    parse_mode: 'Markdown'
  };
}

async function beginInviteRegistration(userId, rawCode) {
  const resolved = resolveInviteCode(userId, rawCode);
  if (!resolved.ok) {
    return { message: resolved.message.replace('o expirado. ', '. ').replace('❌ El owner ya no existe.', '❌ El owner ya no existe. Pide un código nuevo.') };
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
      'Ahora configura tu sheet.\n\n' +
      '📊 *Paso 1:* Comparte tu Google Sheet con mi service account:\n\n' +
      `📧 *Email:* ${GOOGLE_SERVICE_ACCOUNT_EMAIL}\n\n` +
      'Luego ingresa el ID de tu spreadsheet:\n' +
      'Ejemplo: `1abc123def456GHI789jkl012`\n\n' +
      'Usa /cancelar para salir.',
    parse_mode: 'Markdown'
  };
}

module.exports = {
  generateInviteCode,
  buildInviteCodeMessage,
  createInviteCode,
  joinWithInviteCode,
  beginInviteRegistration,
};
