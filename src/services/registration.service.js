const { GoogleSpreadsheet, serviceAccountAuth } = require('../lib/google');
const { GOOGLE_SERVICE_ACCOUNT_EMAIL, MAX_INTENTOS_EMAIL, DASHBOARD_URL, ALLOWED_EMAILS, AUTHORIZED_USER_ID } = require('../config');
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
const tenantRequestService = require('./tenant-request.service');
const { bot } = require('../lib/telegraf');

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
    return { message: buildWelcomeMessage(), parse_mode: 'Markdown' };
  }

  // Si tiene una solicitud aprobada pendiente de configurar el sheet, retomar ese paso
  const solicitudAprobada = await tenantRequestService.buscarSolicitudAprobadaPorTelegramId(userId);
  if (solicitudAprobada) {
    state.pendingRegistros.set(userId, { step: 'sheetId', email: solicitudAprobada.email });
    return {
      message:
        '✅ *¡Tu solicitud fue aprobada!*\n\n' +
        'Ahora configurá tu Google Sheet.\n\n' +
        '📊 *Paso 1:* Compartí tu sheet con mi service account:\n\n' +
        `📧 *Email:* ${GOOGLE_SERVICE_ACCOUNT_EMAIL}\n\n` +
        'Dale permisos de "Editor"\n\n' +
        '📝 Ingresá el ID de tu spreadsheet:\n' +
        'Está en la URL: docs.google.com/spreadsheets/d/**AQUI_EL_ID**/edit\n\n' +
        'Usá /cancelar para salir.',
      parse_mode: 'Markdown',
    };
  }

  beginRegistration(userId);
  return { message: buildStartRegistrationMessage(), parse_mode: 'Markdown' };
}

async function handleEmailStep(userId, text) {
  const emailValidation = validarEmail(text);
  const email = emailValidation.valor;

  if (!emailValidation.ok) {
    const intentos = incrementIntentosEmail(userId);
    if (intentos >= MAX_INTENTOS_EMAIL) {
      state.pendingRegistros.delete(userId);
      state.pendingIntentosEmail.delete(userId);
      return { message: '❌ Demasiados intentos. Usá /start para intentar de nuevo.' };
    }
    return { message: `⚠️ Email inválido. Intentos: ${intentos}/${MAX_INTENTOS_EMAIL}\nEjemplo: juan@empresa.com` };
  }

  // Bypass de emergencia: si el email está en ALLOWED_EMAILS (.env), aprobación directa
  if (esEmailAutorizado(email)) {
    resetIntentosEmail(userId);
    state.pendingRegistros.set(userId, { step: 'sheetId', email, telegramUserId: userId });
    return {
      message:
        '✅ *Email verificado!*\n\n' +
        'Ahora configurá tu Google Sheet.\n\n' +
        '📊 *Paso 1:* Compartí tu sheet con mi service account:\n\n' +
        `📧 *Email:* ${GOOGLE_SERVICE_ACCOUNT_EMAIL}\n\n` +
        'Dale permisos de "Editor"\n\n' +
        '📝 Ingresá el ID de tu spreadsheet:\n' +
        'Está en la URL: docs.google.com/spreadsheets/d/**AQUI_EL_ID**/edit\n\n' +
        'Usá /cancelar para salir.',
    };
  }

  // Verificar estado en tenant_requests
  const solicitud = await tenantRequestService.buscarSolicitudPorEmail(email);

  if (solicitud?.status === 'approved') {
    resetIntentosEmail(userId);
    state.pendingRegistros.set(userId, { step: 'sheetId', email, telegramUserId: userId });
    return {
      message:
        '✅ *Email aprobado!*\n\n' +
        'Ahora configurá tu Google Sheet.\n\n' +
        '📊 *Paso 1:* Compartí tu sheet con mi service account:\n\n' +
        `📧 *Email:* ${GOOGLE_SERVICE_ACCOUNT_EMAIL}\n\n` +
        'Dale permisos de "Editor"\n\n' +
        '📝 Ingresá el ID de tu spreadsheet:\n' +
        'Está en la URL: docs.google.com/spreadsheets/d/**AQUI_EL_ID**/edit\n\n' +
        'Usá /cancelar para salir.',
    };
  }

  if (solicitud?.status === 'pending') {
    state.pendingRegistros.delete(userId);
    resetIntentosEmail(userId);
    return { message: '⏳ Tu solicitud ya está en revisión. Te avisamos cuando esté aprobada.' };
  }

  if (solicitud?.status === 'rejected') {
    state.pendingRegistros.delete(userId);
    resetIntentosEmail(userId);
    return { message: '❌ Tu solicitud fue rechazada. Contactá al administrador para más información.' };
  }

  // No existe → crear solicitud y notificar admin
  const resultado = await tenantRequestService.crearSolicitud(email, userId);
  state.pendingRegistros.delete(userId);
  resetIntentosEmail(userId);

  if (!resultado.ok) {
    console.error('Error al crear tenant_request:', resultado.error);
    return { message: '❌ Error al procesar la solicitud. Intentá de nuevo más tarde.' };
  }

  // Notificar al admin
  if (AUTHORIZED_USER_ID) {
    bot.telegram.sendMessage(
      AUTHORIZED_USER_ID,
      `🔔 *Nueva solicitud de acceso*\n\n📧 Email: \`${email}\`\nID Telegram: \`${userId}\`\n\nUsá /aprobar ${email} para aprobarla.`,
      { parse_mode: 'Markdown' }
    ).catch(err => console.error('Error notificando admin:', err.message));
  }

  return {
    message:
      '📨 *Solicitud enviada*\n\n' +
      'Tu solicitud de acceso fue registrada.\n' +
      'Te notificaremos por acá cuando esté aprobada.\n\n' +
      'Si tenés dudas, contactá al administrador.',
    parse_mode: 'Markdown',
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

    const dashboardBtn = DASHBOARD_URL
      ? { inline_keyboard: [[{ text: '📊 Abrir Dashboard', url: DASHBOARD_URL }]] }
      : undefined;

    if (registro.email) {
      return {
        message:
          `✅ *¡Registro completado!*\n\n` +
          `📧 Email: ${registro.email}\n\n` +
          `Tu sheet ha sido configurado.\n` +
          `Ahora puedes usar el bot.\n\n` +
          `Usa /start para comenzar.`,
        parse_mode: 'Markdown',
        reply_markup: dashboardBtn,
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
      parse_mode: 'Markdown',
      reply_markup: dashboardBtn,
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

  if (registro.step === 'profesional_nombre') {
    const { handleProfesionalNombreStep } = require('../handlers/commands/profesional');
    return handleProfesionalNombreStep(userId, text);
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
