const { GoogleSpreadsheet, serviceAccountAuth } = require('../lib/google');
const { GOOGLE_SERVICE_ACCOUNT_EMAIL, MAX_INTENTOS_EMAIL } = require('../config');
const state = require('../state');
const {
  esAdminOriginal,
  obtenerClientePorUserId,
  esEmailAutorizado,
  incrementIntentosEmail,
  resetIntentosEmail,
} = require('../auth');
const clienteService = require('./cliente.service');
const { beginInviteRegistration } = require('./invite.service');
const { validarEmail, validarSheetId } = require('../utils/validation');
const { ensureSheetStructure } = require('./sheet.service');

function buildWelcomeMessage() {
  return (
    '👋 ¡Hola! Soy tu bot de cashflow para consultorio.\n\n' +
    '📝 *Registrar movimiento:*\n' +
    '`consulta Juan Perez $15000 efectivo` (ingreso pesos)\n' +
    '`servicio Endodoncia U$50 transferencia` (ingreso dólares)\n' +
    '`gasto Insumos $-500` (egreso)\n\n' +
    '📊 *Reportes:*\n' +
    '`/balance` - Resumen completo\n' +
    '`/hoy` - Movimientos de hoy\n' +
    '`/pendientes` - Sin cobrar\n\n' +
    '`/ayuda` - Ver todos los comandos'
  );
}

function buildStartRegistrationMessage() {
  return (
    '📧 *Verificación de email*\n\n' +
    'Ingresa tu email corporativo:\n' +
    'Ejemplo: `juan@tuempresa.com`\n\n' +
    'Solo emails autorizados pueden registrarse.\n' +
    'O usa /cancelar para salir.'
  );
}

function beginRegistration(userId) {
  state.pendingRegistros.set(userId, { step: 'email' });
  resetIntentosEmail(userId);
}

function shouldShowWelcome(userId) {
  return esAdminOriginal(userId) || Boolean(obtenerClientePorUserId(userId));
}

async function handleStart(userId) {
  if (shouldShowWelcome(userId)) {
    return {
      message: buildWelcomeMessage(),
      parse_mode: 'Markdown'
    };
  }

  beginRegistration(userId);
  return {
    message: buildStartRegistrationMessage(),
    parse_mode: 'Markdown'
  };
}

async function handleEmailStep(userId, text) {
  const emailValidation = validarEmail(text);
  const email = emailValidation.valor;

  if (!emailValidation.ok) {
    const intentos = incrementIntentosEmail(userId);
    if (intentos >= MAX_INTENTOS_EMAIL) {
      state.pendingRegistros.delete(userId);
      state.pendingIntentosEmail.delete(userId);
      return { message: '❌ Demasiados intentos. Usa /start para intentar de nuevo.' };
    }
    return { message: `⚠️ Email inválido. Intentos: ${intentos}/${MAX_INTENTOS_EMAIL}\nEjemplo: juan@empresa.com` };
  }

  if (!esEmailAutorizado(email)) {
    const intentos = incrementIntentosEmail(userId);
    if (intentos >= MAX_INTENTOS_EMAIL) {
      state.pendingRegistros.delete(userId);
      state.pendingIntentosEmail.delete(userId);
      return { message: '❌ Email no autorizado. Usa /start para intentar de nuevo.' };
    }
    return { message: `❌ Email no autorizado. Intentos: ${intentos}/${MAX_INTENTOS_EMAIL}` };
  }

  resetIntentosEmail(userId);
  state.pendingRegistros.set(userId, { step: 'sheetId', email, telegramUserId: userId });

  return {
    message:
      '✅ *Email verificado!*\n\n' +
      'Ahora configura tu Google Sheet.\n\n' +
      '📊 *Paso 1:* Comparte tu sheet con mi service account:\n\n' +
      `📧 *Email:* ${GOOGLE_SERVICE_ACCOUNT_EMAIL}\n\n` +
      'Dale permisos de "Editor"\n\n' +
      '📝Ingresa el ID de tu spreadsheet:\n' +
      'Está en la URL: docs.google.com/spreadsheets/d/**AQUI_EL_ID**/edit\n\n' +
      'Usa /cancelar para salir.'
  };
}

async function handleSheetIdStep(userId, text, registro) {
  const sheetValidation = validarSheetId(text);
  if (!sheetValidation.ok) {
    return { message: '⚠️ El ID del spreadsheet parece muy corto. Intenta de nuevo:' };
  }
  const sheetId = sheetValidation.valor;

  try {
    const docTest = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await docTest.loadInfo();
    const firstSheet = docTest.sheetsByIndex[0];
    if (!firstSheet) {
      return { message: '❌ El spreadsheet no tiene ninguna hoja disponible. Crea una pestaña e intenta de nuevo.' };
    }
    await ensureSheetStructure(firstSheet);

    const datosCliente = {
      sheetId,
      email: registro.email,
      telegramUserId: registro.telegramUserId,
      usuarios: [],
      creadoEn: new Date().toISOString()
    };

    const clientes = clienteService.clientes;

    if (registro.ownerId && clientes[registro.ownerId]) {
      datosCliente.ownerId = registro.ownerId;
      clientes[registro.ownerId].usuarios.push(userId);
    }

    clientes[userId] = datosCliente;
    await clienteService.guardarClientes(clientes);

    state.pendingRegistros.delete(userId);

    if (registro.email) {
      return {
        message:
          `✅ *¡Registro completado!*\n\n` +
          `📧 Email: ${registro.email}\n\n` +
          `Tu sheet ha sido configurado.\n` +
          `Ahora puedes usar el bot.\n\n` +
          `Usa /start para comenzar.`,
        parse_mode: 'Markdown'
      };
    }

    return {
      message:
        `✅ *¡Registro completado!*\n\n` +
        `Te uniste a la cuenta del owner.\n\n` +
        `📝 *Próximos pasos:*\n` +
        `1. Comparte este email con tu sheet: *${GOOGLE_SERVICE_ACCOUNT_EMAIL}*\n` +
        `2. Dale permisos de "Editor"\n\n` +
        `Usa /start para comenzar.`,
      parse_mode: 'Markdown'
    };
  } catch (error) {
    console.error('Error al verificar sheet:', error.message);
    return {
      message:
        `❌ No pude acceder al sheet con ese ID.\n\n` +
        `Verifica que:\n` +
        `• El ID sea correcto\n` +
        `• El sheet existe\n` +
        `• Compartiste el sheet con ${GOOGLE_SERVICE_ACCOUNT_EMAIL}\n\n` +
        `Intenta de nuevo:`
    };
  }
}

async function handlePendingRegistration(userId, text) {
  const registro = state.pendingRegistros.get(userId);
  if (!registro) return null;

  if (registro.step === 'email') {
    return handleEmailStep(userId, text);
  }

  if (registro.step === 'codigoInvitacion') {
    return beginInviteRegistration(userId, text);
  }

  if (registro.step === 'sheetId') {
    return handleSheetIdStep(userId, text, registro);
  }

  return { message: '❌ Estado de registro inválido. Usa /cancelar y vuelve a intentar.' };
}

module.exports = {
  handleStart,
  handlePendingRegistration,
  beginRegistration,
  buildWelcomeMessage,
  buildStartRegistrationMessage,
};
