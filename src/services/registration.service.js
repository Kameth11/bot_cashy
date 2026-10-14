const { crearDocumento } = require('../lib/google');
const { GOOGLE_SERVICE_ACCOUNT_EMAIL, MAX_INTENTOS_EMAIL, DASHBOARD_URL, ALLOWED_EMAILS, AUTHORIZED_USER_ID, SPREADSHEET_ID } = require('../config');
const state = require('../state');
const {
  esAdminOriginal,
  obtenerClientePorUserId,
  esEmailAutorizado,
  incrementIntentosEmail,
  resetIntentosEmail,
} = require('../auth');
const clienteService = require('./cliente.service');
const { validarEmail, validarSheetId } = require('../utils/validation');
const { ensureSheetStructure } = require('./sheet.service');
const tenantRequestService = require('./tenant-request.service');
const { bot } = require('../lib/telegraf');
const textos = require('../messages');

function buildWelcomeMessage() {
  return textos.registro.bienvenida();
}

function buildStartRegistrationMessage() {
  return textos.registro.pedirEmail();
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
      message: textos.registro.configurarSheet(textos.registro.tituloSolicitudAprobada, GOOGLE_SERVICE_ACCOUNT_EMAIL),
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
      return { message: textos.registro.demasiadosIntentos };
    }
    return { message: textos.registro.emailInvalido(intentos, MAX_INTENTOS_EMAIL) };
  }

  // Bypass de emergencia: si el email está en ALLOWED_EMAILS (.env), aprobación directa
  if (esEmailAutorizado(email)) {
    resetIntentosEmail(userId);
    state.pendingRegistros.set(userId, { step: 'sheetId', email, telegramUserId: userId });
    return {
      message: textos.registro.configurarSheet(textos.registro.tituloEmailVerificado, GOOGLE_SERVICE_ACCOUNT_EMAIL),
    };
  }

  // Verificar estado en tenant_requests
  const solicitud = await tenantRequestService.buscarSolicitudPorEmail(email);

  if (solicitud?.status === 'approved') {
    resetIntentosEmail(userId);
    state.pendingRegistros.set(userId, { step: 'sheetId', email, telegramUserId: userId });
    return {
      message: textos.registro.configurarSheet(textos.registro.tituloEmailAprobado, GOOGLE_SERVICE_ACCOUNT_EMAIL),
    };
  }

  if (solicitud?.status === 'pending') {
    state.pendingRegistros.delete(userId);
    resetIntentosEmail(userId);
    return { message: textos.registro.solicitudEnRevision };
  }

  if (solicitud?.status === 'rejected') {
    state.pendingRegistros.delete(userId);
    resetIntentosEmail(userId);
    return { message: textos.registro.solicitudRechazada };
  }

  // No existe → crear solicitud y notificar admin
  const resultado = await tenantRequestService.crearSolicitud(email, userId);
  state.pendingRegistros.delete(userId);
  resetIntentosEmail(userId);

  if (!resultado.ok) {
    console.error('Error al crear tenant_request:', resultado.error);
    return { message: textos.registro.errorAlProcesarSolicitud };
  }

  // Notificar al admin
  if (AUTHORIZED_USER_ID) {
    bot.telegram.sendMessage(
      AUTHORIZED_USER_ID,
      textos.registro.avisoAdminNuevaSolicitud(email, userId),
      { parse_mode: 'Markdown' }
    ).catch(err => console.error('Error notificando admin:', err.message));
  }

  return {
    message: textos.registro.solicitudEnviada,
    parse_mode: 'Markdown',
  };
}

async function handleSheetIdStep(userId, text, registro) {
  const sheetValidation = validarSheetId(text);
  if (!sheetValidation.ok) {
    return { message: textos.registro.sheetIdCorto };
  }
  const sheetId = sheetValidation.valor;

  // Un sheet pertenece a un solo consultorio: si ya lo tiene otra cuenta (o es
  // el del admin), registrarlo dejaría a este usuario dentro de ese tenant
  // (los tenants se agrupan por sheet_id).
  const esSheetDelAdmin = SPREADSHEET_ID && sheetId === SPREADSHEET_ID && !esAdminOriginal(userId);
  if (esSheetDelAdmin || clienteService.sheetIdEnUsoPorOtro(sheetId, userId)) {
    console.warn(`Registro rechazado: sheetId ya en uso (userId=${userId})`);
    return { message: textos.registro.sheetEnUso };
  }

  try {
    const docTest = crearDocumento(sheetId);
    await docTest.loadInfo();
    const firstSheet = docTest.sheetsByIndex[0];
    if (!firstSheet) {
      return { message: textos.registro.sheetSinHojas };
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
    clientes[userId] = datosCliente;
    await clienteService.guardarClientes(clientes, userId);

    state.pendingRegistros.delete(userId);

    const dashboardBtn = DASHBOARD_URL
      ? { inline_keyboard: [[{ text: textos.registro.botonDashboard, url: DASHBOARD_URL }]] }
      : undefined;

    return {
      message: textos.registro.registroCompleto(registro.email),
      parse_mode: 'Markdown',
      reply_markup: dashboardBtn,
    };
  } catch (error) {
    console.error('Error al verificar sheet:', error.message);
    return {
      message: textos.registro.sheetSinAcceso(GOOGLE_SERVICE_ACCOUNT_EMAIL)
    };
  }
}

async function handlePendingRegistration(userId, text) {
  const registro = state.pendingRegistros.get(userId);
  if (!registro) return null;

  if (registro.step === 'email') {
    return handleEmailStep(userId, text);
  }

  if (registro.step === 'sheetId') {
    return handleSheetIdStep(userId, text, registro);
  }

  if (registro.step === 'profesional_nombre') {
    const { handleProfesionalNombreStep } = require('../handlers/commands/profesional');
    return handleProfesionalNombreStep(userId, text);
  }

  if (registro.step === 'profesional_consultorio') {
    const { handleProfesionalConsultorioStep } = require('../handlers/commands/profesional');
    return handleProfesionalConsultorioStep(userId, text, registro);
  }

  return { message: textos.registro.estadoInvalido };
}

module.exports = {
  handleStart,
  handlePendingRegistration,
  beginRegistration,
  buildWelcomeMessage,
  buildStartRegistrationMessage,
};
