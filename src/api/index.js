const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { notificarLlegadaPaciente } = require('../services/profesional.service');
const { resolveTenantId } = require('../services/tenant.service');
const { getSupabase, isAvailable } = require('../lib/supabase');
const { esAdminOriginal, obtenerClientePorUserId, resolverPermisos } = require('../auth');
const { PERMISOS, PRESETS, validarPermisos, detectarPreset } = require('../auth/permisos');
const { setPermisos: guardarPermisos } = require('../services/cliente.service');
const { obtenerDatosSheet, getSheetId } = require('../services/sheet.service');
const { ejecutarBalance, ejecutarHoy, ejecutarSemana, ejecutarMes } = require('../services/command.service');
const {
  guardarMovimiento,
  calcularMontoPesos,
} = require('../services/movimiento.service');
const {
  updateMovimiento,
  deleteMovimiento,
  deleteMovimientoByKey,
} = require('../services/db.service');
const tenantRequestService = require('../services/tenant-request.service');
const {
  obtenerTurnosPorFecha,
  obtenerTurnoPorId,
  actualizarEstadoTurno,
  actualizarDatosTurno,
  eliminarTurno,
  crearTurno,
  fechaHoyStr,
} = require('../services/agenda.service');
const clienteService = require('../services/cliente.service');
const personalService = require('../services/personal.service');
const {
  normalizarCategoriaPersonal,
  CATEGORIAS_EGRESO_PERSONAL,
  CATEGORIAS_INGRESO_PERSONAL,
} = require('../services/personal-nlp.service');
const { sanitizarInput } = require('../utils/formatter');
const { normalizarDescripcion, validarMonto } = require('../utils/validation');
const { obtenerCotizacionDolar } = require('../services/cotizacion.service');
const eventsService = require('../services/events.service');
const loginTelegram = require('../services/login-telegram.service');
const { obtenerUsernameBot } = require('../lib/bot-info');
const state = require('../state');
const logger = require('../lib/logger');
const { createLimiter } = require('../lib/rate-limiter');

const app = express();

// Headers de seguridad estándar (HSTS, X-Content-Type-Options, X-Frame-Options,
// etc.). Se desactiva la Content-Security-Policy: el mismo Express sirve el
// build estático del dashboard (SPA de Vite) y la CSP por defecto de helmet lo
// rompería. El resto de los headers no afecta al SPA.
app.use(helmet({ contentSecurityPolicy: false }));

// Railway (y cualquier PaaS) pone un proxy delante: sin esto req.ip es la IP
// del proxy para TODOS los clientes y los rate limiters por IP terminan
// siendo un único bucket global. 1 = confiar solo en el salto más cercano.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

const ALLOWED_ORIGINS = [
  ...(process.env.DASHBOARD_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim()),
  ...(process.env.RAILWAY_PUBLIC_DOMAIN ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`] : []),
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS bloqueado: ${origin}`));
  },
  credentials: true,
  exposedHeaders: ['X-Refreshed-Token'],
}));
app.use(express.json());

// Healthcheck para Railway (railway.json). Va fuera de /api: sin auth ni rate
// limit, y no toca Sheets/Supabase (solo dice que el proceso atiende requests).
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

// Rate limit global de las rutas de datos: protege la cuota de Google Sheets
// y la DB de un dashboard con refresh agresivo o de abuso. Se aplica por IP
// (robusto contra rotación de tokens). Quedan afuera: /api/auth/* (tiene su
// propio limiter más estricto), /api/events (SSE, conexión larga de una sola
// request) y /api/cotizacion (pública y barata).
const apiDataLimiter = createLimiter({ windowMs: 60 * 1000, max: 120 });
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/events' || req.path === '/cotizacion') {
    return next();
  }
  if (!apiDataLimiter(req.ip).allowed) {
    logger.audit('api_rate_limit_blocked', { route: req.path });
    return res.status(429).json({ error: 'Demasiadas peticiones. Probá de nuevo en un momento.' });
  }
  next();
});

const PORT = process.env.DASHBOARD_API_PORT || process.env.PORT || 3001;
const JWT_SECRET = config.JWT_SECRET;

// Sesión del dashboard. Antes: 180 días con renovación deslizante, o sea que un
// token filtrado servía para siempre mientras alguien lo usara, y no se
// invalidaba al sacar al usuario. Ahora:
//  - el token dura pocos días y se renueva solo mientras se usa (X-Refreshed-Token);
//  - la renovación NO extiende el "login original" (`authAt`): pasado
//    SESSION_MAX_DAYS hay que pedir un código nuevo, se use o no;
//  - en cada request se verifica que el usuario siga registrado, así quitar a
//    alguien (/salir, /accesos, DELETE /api/users) le corta la sesión al toque.
// Para invalidar TODAS las sesiones de golpe: rotar JWT_SECRET.
const diasEnv = (nombre, porDefecto) => {
  const n = Number(process.env[nombre]);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
};
const SESSION_DAYS = diasEnv('SESSION_DURATION_DAYS', 14);
const SESSION_MAX_DAYS = diasEnv('SESSION_MAX_DAYS', 90);
const SESSION_DURATION = `${SESSION_DAYS}d`;
const SESSION_REFRESH_THRESHOLD_SEC = (SESSION_DAYS / 2) * 24 * 60 * 60; // renovar cuando queda la mitad
const SESSION_MAX_SEC = SESSION_MAX_DAYS * 24 * 60 * 60;

function firmarSesion(userId, authAt = Math.floor(Date.now() / 1000)) {
  return jwt.sign({ userId: String(userId), type: 'dashboard', authAt }, JWT_SECRET, { expiresIn: SESSION_DURATION });
}

// ¿El usuario sigue existiendo en el sistema? (admin, dueño o invitado)
function usuarioRegistrado(userId) {
  const id = Number(userId);
  return Boolean(esAdminOriginal(id) || obtenerClientePorUserId(id));
}

// Forma del usuario que reciben el dashboard (login, /me): una sola definición.
function datosUsuario(userId) {
  const id = String(userId);
  const cliente = obtenerClientePorUserId(Number(id));
  const esAdmin = esAdminOriginal(Number(id));
  return {
    userId: id,
    isAdmin: esAdmin,
    isOwner: esAdmin || !!cliente?.isOwner,
    email: cliente?.email || null,
    sheetId: getSheetId(Number(id)),
    permisos: resolverPermisos(id),
    modoFullIA: cliente?.modoFullIA || false,
  };
}

// Sesión completa ({token, user}). Es el ÚNICO lugar que entrega el JWT al
// dashboard, para poder migrarlo a una cookie httpOnly sin tocar cada login.
function armarSesion(userId) {
  return { token: firmarSesion(userId), user: datosUsuario(userId) };
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const ahora = Date.now() / 1000;

    // Tokens emitidos antes de este cambio no traen authAt. En vez de deducirlo
    // de su iat (que es la última renovación, no el login: sacaba de la sesión
    // a gente que la estaba usando), se les da el tope completo desde ahora y
    // se les renueva el token enseguida con authAt propio (migración una vez).
    const legado = !Number(decoded.authAt);
    const authAt = legado ? Math.floor(ahora) : Number(decoded.authAt);
    if (ahora - authAt > SESSION_MAX_SEC) {
      logger.audit('sesion_vencida_por_antiguedad', { userId: decoded.userId });
      return res.status(401).json({ error: 'Sesión vencida. Volvé a iniciar sesión.' });
    }

    if (!usuarioRegistrado(decoded.userId) && process.env.NODE_ENV !== 'development') {
      logger.audit('sesion_usuario_no_registrado', { userId: decoded.userId });
      return res.status(401).json({ error: 'Sesión inválida' });
    }

    req.user = decoded;

    // Sesion deslizante: si al usuario le queda poco tiempo de token, le mandamos
    // uno nuevo en la respuesta (conserva authAt: no alarga el login original).
    if (legado || (decoded.exp && decoded.exp - ahora < SESSION_REFRESH_THRESHOLD_SEC)) {
      res.setHeader('X-Refreshed-Token', firmarSesion(decoded.userId, authAt));
    }

    next();
  } catch (err) {
    logger.warn('AUTH', 'Token rechazado en authMiddleware', {
      route: req.path,
      errName: err.name,
      errMessage: err.message,
    });
    res.status(401).json({ error: 'Token invalido o expirado' });
  }
}

function adminOnly(req, res, next) {
  if (!esAdminOriginal(req.user?.userId)) return res.status(403).json({ error: 'Solo el administrador' });
  next();
}

// Comparación en tiempo constante para no filtrar el DASHBOARD_DEV_TOKEN por
// timing (una comparación === corta apenas difiere el primer caracter).
function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Permite el acceso solo al dueño del consultorio (isOwner) o al admin global.
function ownerOnly(req, res, next) {
  const cliente = obtenerClientePorUserId(Number(req.user?.userId));
  if (!cliente?.isOwner && !esAdminOriginal(req.user?.userId)) {
    return res.status(403).json({ error: 'Solo el dueño del consultorio' });
  }
  next();
}

// Middleware de permiso granular. Resuelve permisos por request (no desde el JWT)
// para que los cambios de permisos impacten sin necesidad de re-login.
function requierePermiso(permiso) {
  return (req, res, next) => {
    const permisos = resolverPermisos(req.user?.userId);
    if (!permisos.includes(permiso)) {
      logger.audit('permiso_denegado', { userId: req.user?.userId, permiso, route: req.path });
      return res.status(403).json({ error: 'No tenés permiso para esta acción' });
    }
    next();
  };
}

// Rate limiting de las rutas de auth: doble clave (IP + telegramId) para que
// no sea bypasseable variando solo una de las dos.
const requestCodeByIp   = createLimiter({ windowMs: 10 * 60 * 1000, max: 20 });
const requestCodeByUser = createLimiter({ windowMs: 10 * 60 * 1000, max: 5 });
const verifyByIp        = createLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
const verifyByUser      = createLimiter({ windowMs: 10 * 60 * 1000, max: 10 });
// Login con Telegram: la solicitud se crea al mostrar la pantalla de login (así el enlace
// ya está listo y el toque del usuario no lo bloquea el navegador), por eso el cupo por IP
// es holgado (varias personas de un mismo consultorio comparten IP). Crear solicitudes es
// barato de abusar (cada una ocupa memoria) y esperar la aprobación es un polling cada ~2 s durante 5 min (≈150 requests).
const telegramStartByIp  = createLimiter({ windowMs: 10 * 60 * 1000, max: 20 });
const telegramStatusByIp = createLimiter({ windowMs: 10 * 60 * 1000, max: 300 });
const telegramStatusById = createLimiter({ windowMs: 10 * 60 * 1000, max: 200 });

function rateLimit(limiter, keyFn) {
  return (req, res, next) => {
    const key = keyFn(req);
    if (!limiter(key).allowed) {
      logger.audit('rate_limit_blocked', { route: req.path });
      return res.status(429).json({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.' });
    }
    next();
  };
}

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Acepta solo fechas en formato YYYY-MM-DD (input type="date") o vacio/ausente.
function validarFechaOpcional(valor) {
  if (valor === undefined || valor === null || valor === '') return { ok: true, valor: '' };
  const texto = String(valor).trim();
  if (!FECHA_REGEX.test(texto) || Number.isNaN(new Date(texto).getTime())) {
    return { ok: false };
  }
  return { ok: true, valor: texto };
}

// Códigos de acceso del dashboard. Supabase (auth_codes) es la fuente de verdad
// cuando está disponible, así el código pedido en una instancia verifica en
// cualquier otra y sobrevive a un redeploy; el Map en memoria es el respaldo si
// Supabase no está o falla. Si ambos tienen el código, vale el que vence después
// (el más reciente), por si la persistencia en Supabase falló al pedirlo.
const authCodes = new Map();

function purgarCodigosVencidos() {
  const ahora = Date.now();
  for (const [id, c] of authCodes) {
    if (c.expiresAt.getTime() < ahora) authCodes.delete(id);
  }
}

async function leerCodigoAuth(telegramId) {
  const enMemoria = authCodes.get(telegramId) || null;
  if (!(isAvailable() && getSupabase())) return enMemoria;

  let enDb = null;
  try {
    const { data, error } = await getSupabase().from('auth_codes').select('*').eq('telegram_user_id', telegramId).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) enDb = { code: data.code, expiresAt: new Date(data.expires_at), used: data.used, intentos: data.intentos || 0 };
  } catch (err) {
    logger.warn('AUTH', 'No se pudo leer auth_code de Supabase, uso memoria', { telegramId, err: err.message });
    return enMemoria;
  }

  if (enDb && enMemoria) return enMemoria.expiresAt > enDb.expiresAt ? enMemoria : enDb;
  return enDb || enMemoria;
}

// ── Auth: request code ──
app.post('/api/auth/request-code',
  rateLimit(requestCodeByIp, req => req.ip),
  rateLimit(requestCodeByUser, req => String(req.body.userId)),
  async (req, res) => {
  const { userId } = req.body;
  if (!userId || isNaN(Number(userId))) return res.status(400).json({ error: 'userId invalido' });
  const telegramId = String(userId);
  const cliente = obtenerClientePorUserId(Number(telegramId));
  const esAdmin = esAdminOriginal(Number(telegramId));
  if (!cliente && !esAdmin && process.env.NODE_ENV !== 'development')
    return res.status(403).json({ error: 'Usuario no registrado en el sistema' });

  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  if (isAvailable() && getSupabase()) {
    try {
      await getSupabase().from('auth_codes').upsert(
        { telegram_user_id: telegramId, code, expires_at: expiresAt.toISOString(), used: false, intentos: 0 },
        { onConflict: 'telegram_user_id' }
      );
    } catch (err) {
      logger.warn('AUTH', 'No se pudo persistir auth_code en Supabase', { telegramId, err: err.message });
    }
  }
  purgarCodigosVencidos();
  authCodes.set(telegramId, { code, expiresAt, used: false, intentos: 0 });

  try {
    const { bot } = require('../lib/telegraf');
    await bot.telegram.sendMessage(Number(telegramId),
      `🔐 Codigo de acceso a Cashy Dashboard:\n\n*${code}*\n\nVence en 10 minutos.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error('AUTH', 'Error enviando codigo por Telegram', { telegramId, err: err.message });
    logger.audit('auth_code_send_failed', { telegramId });
    return res.status(500).json({ error: 'No se pudo enviar el codigo por Telegram. Ya iniciaste el bot con /start?' });
  }
  logger.audit('auth_code_requested', { telegramId });
  res.json({ success: true, message: 'Codigo enviado por Telegram' });
});

// ── Auth: verify code ──
app.post('/api/auth/verify',
  rateLimit(verifyByIp, req => req.ip),
  rateLimit(verifyByUser, req => String(req.body.userId || req.ip)),
  async (req, res) => {
  const { userId, code } = req.body;
  if (!userId || !code) return res.status(400).json({ error: 'userId y codigo son requeridos' });
  const telegramId = String(userId);

  const DEV_TOKEN = process.env.DASHBOARD_DEV_TOKEN;
  if (DEV_TOKEN && process.env.NODE_ENV === 'development' && timingSafeEqualStr(code, DEV_TOKEN)) {
    logger.audit('auth_dev_token_login', { telegramId });
    return res.json(armarSesion(telegramId));
  }

  const codeData = await leerCodigoAuth(telegramId);

  if (!codeData) {
    logger.audit('auth_verify_failed', { telegramId, reason: 'no_code_requested' });
    return res.status(400).json({ error: 'No hay codigo solicitado para este usuario' });
  }
  if (codeData.used) {
    logger.audit('auth_verify_failed', { telegramId, reason: 'code_already_used' });
    return res.status(400).json({ error: 'Codigo ya utilizado' });
  }
  if ((codeData.intentos || 0) >= config.MAX_INTENTOS_CODIGO) {
    logger.audit('auth_verify_failed', { telegramId, reason: 'too_many_attempts' });
    return res.status(400).json({ error: 'Demasiados intentos fallidos. Pedí un código nuevo.' });
  }
  if (new Date() > codeData.expiresAt) {
    logger.audit('auth_verify_failed', { telegramId, reason: 'code_expired' });
    return res.status(400).json({ error: 'Codigo expirado' });
  }
  if (codeData.code !== code) {
    codeData.intentos = (codeData.intentos || 0) + 1;
    authCodes.set(telegramId, codeData);
    if (isAvailable() && getSupabase()) {
      try {
        await getSupabase().from('auth_codes').update({ intentos: codeData.intentos }).eq('telegram_user_id', telegramId);
      } catch (err) {
        logger.warn('AUTH', 'No se pudo persistir intentos de auth_code en Supabase', { telegramId, err: err.message });
      }
    }

    logger.audit('auth_verify_failed', { telegramId, reason: 'code_incorrect', intentos: codeData.intentos });
    if (codeData.intentos >= config.MAX_INTENTOS_CODIGO) {
      return res.status(400).json({ error: 'Código incorrecto. Se agotaron los intentos — pedí un código nuevo.' });
    }
    return res.status(400).json({ error: 'Codigo incorrecto' });
  }

  codeData.used = true;
  authCodes.set(telegramId, codeData);
  if (isAvailable() && getSupabase()) {
    try {
      await getSupabase().from('auth_codes').update({ used: true }).eq('telegram_user_id', telegramId);
    } catch (err) {
      logger.warn('AUTH', 'No se pudo marcar auth_code como usado en Supabase', { telegramId, err: err.message });
    }
  }

  logger.audit('auth_verify_success', { telegramId, esAdmin: esAdminOriginal(Number(telegramId)) });
  res.json(armarSesion(telegramId));
});

// ── Auth: me ──
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: datosUsuario(req.user.userId) });
});

// ── Auth: entrar con Telegram (deep link + confirmación en el bot) ──
// El navegador crea una solicitud, la persona la aprueba en el bot y el navegador
// recibe la sesión. Ver services/login-telegram.service.js. Estos endpoints
// NUNCA responden 401: el interceptor del dashboard recargaría la página.
app.post('/api/auth/telegram/start',
  rateLimit(telegramStartByIp, req => req.ip),
  async (req, res) => {
  try {
    const username = await obtenerUsernameBot().catch(() => null);
    if (!username) {
      return res.status(503).json({ error: 'El ingreso con Telegram no está disponible ahora. Usá el código.' });
    }
    const s = loginTelegram.crearSolicitud({ ip: req.ip, userAgent: req.headers['user-agent'] });
    logger.audit('auth_telegram_login_solicitado', { loginId: s.id, ip: req.ip });
    res.status(201).json({
      id: s.id,
      secret: s.secret,
      deepLink: `https://t.me/${username}?start=login_${s.id}`,
      expiraEnSeg: s.expiraEnSeg,
    });
  } catch (err) {
    if (err.message === 'demasiadas_solicitudes') {
      return res.status(429).json({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.' });
    }
    logger.error('API', 'Error POST /api/auth/telegram/start', { err: err.message });
    res.status(500).json({ error: 'No se pudo iniciar el ingreso' });
  }
});

app.post('/api/auth/telegram/status',
  rateLimit(telegramStatusByIp, req => req.ip),
  rateLimit(telegramStatusById, req => String((req.body || {}).id || req.ip)),
  (req, res) => {
  const { id, secret } = req.body || {};
  const r = loginTelegram.consultar(id, secret);

  if (r.estado === 'aprobada') {
    // Entre la aprobación y la entrega la persona pudo ser dada de baja.
    if (!usuarioRegistrado(r.userId) && process.env.NODE_ENV !== 'development') {
      logger.audit('auth_telegram_login_rechazado', { loginId: id, motivo: 'usuario_no_registrado' });
      return res.json({ estado: 'rechazada' });
    }
    logger.audit('auth_telegram_login_entregado', { loginId: id, userId: r.userId, ip: req.ip });
    return res.json({ estado: 'aprobada', ...armarSesion(r.userId) });
  }
  res.json({ estado: r.estado });
});

app.post('/api/config/modo-ia', authMiddleware, ownerOnly, async (req, res) => {
  const cliente = obtenerClientePorUserId(Number(req.user.userId));
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  const enabled = Boolean(req.body?.enabled);
  await clienteService.setModoFullIA(cliente.ownerId, enabled);
  res.json({ modoFullIA: enabled });
});

// ── Cache de movimientos (30s) ──
// Keyeada por sheetId (no por userId): el dueño y sus invitados comparten el
// mismo sheet, así que tienen que compartir la misma entrada de cache — si
// no, un invitado podía seguir viendo datos viejos después de que el dueño
// (u otro invitado) cargara/editara un movimiento, y viceversa.
const _movCache = new Map();
const MOV_CACHE_TTL = 30 * 1000;

function movCacheKey(userId) {
  return getSheetId(userId) || String(userId);
}

async function getDatosConCache(userId) {
  const key = movCacheKey(userId);
  const cached = _movCache.get(key);
  if (cached && Date.now() - cached.ts < MOV_CACHE_TTL) return cached.data;
  const data = await obtenerDatosSheet(userId);
  _movCache.set(key, { data, ts: Date.now() });
  return data;
}

function invalidarCacheMovimientos(userId) { _movCache.delete(movCacheKey(userId)); }

// Cuando un movimiento se crea/edita/borra desde CUALQUIER lado (bot o dashboard),
// invalidamos la cache de /api/movimientos para que el siguiente fetch del
// dashboard (disparado por el evento SSE) traiga datos frescos.
eventsService.onMovimientosUpdated(invalidarCacheMovimientos);

// ── Eventos en tiempo real (SSE) ──
// El frontend se conecta via fetch + ReadableStream (no EventSource) para poder
// mandar el token en el header Authorization en lugar de la URL.
app.get('/api/events', authMiddleware, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': connected\n\n');

  eventsService.subscribe(req.user.userId, res);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    eventsService.unsubscribe(req.user.userId, res);
  });
});

// ── Movimientos: list ──
app.get('/api/movimientos', authMiddleware, requierePermiso('ver_movimientos'), async (req, res) => {
  try {
    const { tipo, estado, profesional, paciente, desde, hasta, buscar } = req.query;
    const datos = await getDatosConCache(req.user.userId);
    const { normalizarFecha } = require('../utils/date');
    const desdeDate = desde ? new Date(desde) : null;
    const hastaDate = hasta ? new Date(hasta) : null;

    let filtered = datos;
    if (tipo) filtered = filtered.filter(d => d.tipo?.toLowerCase() === tipo.toLowerCase());
    if (estado) filtered = filtered.filter(d => d.estado?.toLowerCase() === estado.toLowerCase());
    if (profesional) filtered = filtered.filter(d => (d.profesional || '').toLowerCase().includes(profesional.toLowerCase()));
    if (paciente) filtered = filtered.filter(d => (d.paciente || '').toLowerCase().includes(paciente.toLowerCase()));
    if (buscar) {
      const q = buscar.toLowerCase();
      filtered = filtered.filter(d =>
        (d.descripcion || '').toLowerCase().includes(q) ||
        (d.paciente    || '').toLowerCase().includes(q) ||
        (d.profesional || '').toLowerCase().includes(q) ||
        (d.categoria   || '').toLowerCase().includes(q)
      );
    }
    if (desdeDate) filtered = filtered.filter(d => { const f = normalizarFecha(d.fecha); return f && f >= desdeDate; });
    if (hastaDate) filtered = filtered.filter(d => { const f = normalizarFecha(d.fecha); return f && f <= hastaDate; });

    res.json({ movimientos: filtered, total: datos.length });
  } catch (err) {
    logger.error('API', 'Error /api/movimientos', { err: err.message });
    res.status(500).json({ error: 'Error al obtener movimientos' });
  }
});

// ── Movimientos: create ──
app.post('/api/movimientos', authMiddleware, requierePermiso('cargar_movimientos'), async (req, res) => {
  try {
    const body = req.body || {};

    const descripcionValidada = normalizarDescripcion(body.descripcion);
    if (!descripcionValidada.ok) return res.status(400).json({ error: 'La descripción es inválida' });

    const montoValidado = validarMonto(body.monto);
    if (!montoValidado.ok) return res.status(400).json({ error: 'El monto es inválido' });

    const fechaPrestacionValidada = validarFechaOpcional(body.fechaPrestacion);
    if (!fechaPrestacionValidada.ok) return res.status(400).json({ error: 'La fecha de prestación es inválida' });

    const fechaVencimientoValidada = validarFechaOpcional(body.fechaVencimiento);
    if (!fechaVencimientoValidada.ok) return res.status(400).json({ error: 'La fecha de vencimiento es inválida' });

    const tipo = body.tipo === 'Egreso' ? 'Egreso' : 'Ingreso';
    const moneda = ['Dolares', 'Dólares'].includes(body.moneda) ? 'Dólares' : body.moneda === 'Euros' ? 'Euros' : 'Pesos';
    const estado = body.estado === 'Pendiente' ? 'Pendiente' : 'Cobrado';
    const metodoPago = ['efectivo', 'transferencia', 'tarjeta'].includes(body.metodoPago) ? body.metodoPago : '';

    const montoAbs = Math.abs(montoValidado.valor);
    const monto = tipo === 'Egreso' ? -montoAbs : montoAbs;

    if ((moneda === 'Dólares' && !state.cotizacionDolar) || (moneda === 'Euros' && !state.cotizacionEuro)) {
      await obtenerCotizacionDolar();
    }

    const resultado = await guardarMovimiento(req.user.userId, {
      descripcion: descripcionValidada.valor,
      monto,
      tipo,
      moneda,
      metodoPago,
      estado,
      categoria:         sanitizarInput(body.categoria, 40),
      pacienteNombre:    sanitizarInput(body.paciente, 100),
      profesionalNombre: sanitizarInput(body.profesional, 100),
      tratamientoNombre: sanitizarInput(body.tratamiento, 100),
      proveedorNombre:   sanitizarInput(body.proveedor, 100),
      fechaPrestacion:   fechaPrestacionValidada.valor,
      fechaVencimiento:  fechaVencimientoValidada.valor,
    });

    if (!resultado) return res.status(500).json({ error: 'No se pudo guardar el movimiento' });
    invalidarCacheMovimientos(req.user.userId);
    logger.audit('movimiento_created', { userId: req.user.userId, monto, tipo });
    res.status(201).json({ movimiento: resultado });
  } catch (err) {
    logger.error('API', 'Error POST /api/movimientos', { err: err.message });
    res.status(500).json({ error: 'Error al guardar movimiento' });
  }
});

// ── Movimientos: update ──
app.put('/api/movimientos/:idUnico', authMiddleware, requierePermiso('editar_movimientos'), async (req, res) => {
  try {
    const { idUnico } = req.params;
    const body = req.body || {};
    const updates = {};
    if (body.descripcion !== undefined) {
      const desc = normalizarDescripcion(body.descripcion);
      if (!desc.ok) return res.status(400).json({ error: 'La descripción es inválida' });
      updates.descripcion = desc.valor;
    }
    if (body.monto !== undefined) {
      const monto = validarMonto(body.monto);
      if (!monto.ok) return res.status(400).json({ error: 'El monto es inválido' });
      updates.monto = monto.valor;
    }
    if (body.estado      !== undefined) updates.estado      = ['Cobrado', 'Pendiente'].includes(body.estado) ? body.estado : undefined;
    if (body.metodoPago  !== undefined) updates.metodoPago  = ['efectivo', 'transferencia', 'tarjeta'].includes(body.metodoPago) ? body.metodoPago : '';
    if (body.moneda      !== undefined) updates.moneda      = ['Pesos', 'Dólares', 'Euros'].includes(body.moneda) ? body.moneda : undefined;
    Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No hay campos validos para actualizar' });

    if ((updates.moneda === 'Dólares' && !state.cotizacionDolar) || (updates.moneda === 'Euros' && !state.cotizacionEuro)) {
      await obtenerCotizacionDolar();
    }

    await updateMovimiento(req.user.userId, idUnico, updates);
    invalidarCacheMovimientos(req.user.userId);
    logger.audit('movimiento_updated', { userId: req.user.userId, idUnico, fields: Object.keys(updates) });
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'movimiento_no_encontrado') return res.status(404).json({ error: 'Movimiento no encontrado' });
    logger.error('API', 'Error PUT /api/movimientos', { err: err.message });
    res.status(500).json({ error: 'Error al actualizar movimiento' });
  }
});

// ── Movimientos: delete por ID ──
app.delete('/api/movimientos/:idUnico', authMiddleware, requierePermiso('editar_movimientos'), async (req, res) => {
  try {
    await deleteMovimiento(req.user.userId, req.params.idUnico);
    invalidarCacheMovimientos(req.user.userId);
    logger.audit('movimiento_deleted', { userId: req.user.userId, idUnico: req.params.idUnico });
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'movimiento_no_encontrado') return res.status(404).json({ error: 'Movimiento no encontrado' });
    logger.error('API', 'Error DELETE /api/movimientos', { err: err.message });
    res.status(500).json({ error: 'Error al eliminar movimiento' });
  }
});

// ── Movimientos: delete por clave compuesta (filas sin ID_Unico) ──
app.delete('/api/movimientos-by-key', authMiddleware, requierePermiso('editar_movimientos'), async (req, res) => {
  try {
    const { descripcion, monto, fecha } = req.body || {};
    if (!descripcion || monto === undefined) return res.status(400).json({ error: 'descripcion y monto son requeridos' });
    await deleteMovimientoByKey(req.user.userId, { descripcion, monto, fecha });
    invalidarCacheMovimientos(req.user.userId);
    logger.audit('movimiento_deleted', { userId: req.user.userId, descripcion });
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'movimiento_no_encontrado') return res.status(404).json({ error: 'No se encontro la fila. Ejecuta /regenerar_ids en el bot e intenta de nuevo.' });
    logger.error('API', 'Error DELETE /api/movimientos-by-key', { err: err.message });
    res.status(500).json({ error: 'Error al eliminar movimiento' });
  }
});

// ── Usuarios (admin only) ──
app.get('/api/users', authMiddleware, adminOnly, (req, res) => {
  const clientes = clienteService.clientes;
  const users = Object.entries(clientes).map(([userId, c]) => ({
    userId,
    email: c.email || null,
    sheetId: c.sheetId || null,
    creadoEn: c.creadoEn || null,
  }));
  res.json({ users });
});

app.delete('/api/users/:userId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId } = req.params;
    if (esAdminOriginal(Number(userId))) {
      return res.status(400).json({ error: 'No puedes eliminar al administrador' });
    }
    const eliminado = await clienteService.eliminarCliente(userId);
    if (!eliminado) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true, mensaje: `Usuario ${userId} eliminado` });
  } catch (err) {
    logger.error('API', 'Error DELETE /api/users', { err: err.message });
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

// ── Solicitudes de acceso (admin only) ──
app.get('/api/admin/tenant-requests', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status } = req.query;
    let solicitudes;
    if (status === 'all') {
      const supabase = require('../lib/supabase').getSupabase();
      const { data, error } = await supabase
        .from('tenant_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      solicitudes = data || [];
    } else {
      solicitudes = await tenantRequestService.listarSolicitudesPendientes();
    }
    res.json({ solicitudes });
  } catch (err) {
    logger.error('API', 'Error GET /api/admin/tenant-requests', { err: err.message });
    res.status(500).json({ error: 'Error al obtener solicitudes' });
  }
});

app.post('/api/admin/tenant-requests/:id/approve', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = require('../lib/supabase').getSupabase();
    const { data: solicitud, error: fetchErr } = await supabase
      .from('tenant_requests')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !solicitud) return res.status(404).json({ error: 'Solicitud no encontrada' });

    const resultado = await tenantRequestService.aprobarSolicitud(solicitud.email, req.user.userId);
    if (!resultado.ok) return res.status(500).json({ error: resultado.error });

    if (solicitud.telegram_user_id) {
      const state = require('../state');
      state.pendingRegistros.set(solicitud.telegram_user_id, {
        step: 'sheetId',
        email: solicitud.email,
        telegramUserId: solicitud.telegram_user_id,
      });
      const { bot } = require('../lib/telegraf');
      bot.telegram.sendMessage(
        solicitud.telegram_user_id,
        '✅ *¡Tu solicitud fue aprobada!*\n\n' +
        'Ya podés configurar tu cuenta.\n\n' +
        '📊 *Paso 1:* Compartí tu Google Sheet con mi service account:\n\n' +
        `📧 *Email:* ${config.GOOGLE_SERVICE_ACCOUNT_EMAIL}\n\n` +
        'Dale permisos de "Editor"\n\n' +
        '📝 Ingresá el ID de tu spreadsheet:\n' +
        'Está en la URL: docs.google.com/spreadsheets/d/**AQUI_EL_ID**/edit\n\n' +
        'O usá /start si querés retomar más tarde.',
        { parse_mode: 'Markdown' }
      ).catch(err => logger.warn('API', 'Error notificando usuario aprobado', { err: err.message }));
    }

    logger.audit('tenant_request_approved', { adminId: req.user.userId, email: solicitud.email });
    res.json({ ok: true });
  } catch (err) {
    logger.error('API', 'Error POST /api/admin/tenant-requests/:id/approve', { err: err.message });
    res.status(500).json({ error: 'Error al aprobar solicitud' });
  }
});

app.post('/api/admin/tenant-requests/:id/reject', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = require('../lib/supabase').getSupabase();
    const { data: solicitud, error: fetchErr } = await supabase
      .from('tenant_requests')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !solicitud) return res.status(404).json({ error: 'Solicitud no encontrada' });

    const resultado = await tenantRequestService.rechazarSolicitud(solicitud.email, req.user.userId);
    if (!resultado.ok) return res.status(500).json({ error: resultado.error });

    if (solicitud.telegram_user_id) {
      const { bot } = require('../lib/telegraf');
      bot.telegram.sendMessage(
        solicitud.telegram_user_id,
        '❌ Tu solicitud de acceso fue rechazada.\n\nSi creés que es un error, contactá al administrador.',
      ).catch(err => logger.warn('API', 'Error notificando usuario rechazado', { err: err.message }));
    }

    logger.audit('tenant_request_rejected', { adminId: req.user.userId, email: solicitud.email });
    res.json({ ok: true });
  } catch (err) {
    logger.error('API', 'Error POST /api/admin/tenant-requests/:id/reject', { err: err.message });
    res.status(500).json({ error: 'Error al rechazar solicitud' });
  }
});

// ── Profesionales ──
app.get('/api/profesionales', authMiddleware, requierePermiso('ver_agenda'), async (req, res) => {
  try {
    const datos = await getDatosConCache(req.user.userId);
    const set = new Set();
    datos.forEach(d => { if (d.profesional) set.add(d.profesional); });
    res.json({ profesionales: Array.from(set) });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener profesionales' });
  }
});

// ── Metrics ──
app.get('/api/metrics', authMiddleware, requierePermiso('ver_balance'), async (req, res) => {
  try {
    const { periodo = 'hoy' } = req.query;
    let texto;
    if (periodo === 'hoy') texto = await ejecutarHoy(req.user.userId);
    else if (periodo === 'semana') texto = await ejecutarSemana(req.user.userId);
    else if (periodo === 'mes') texto = await ejecutarMes(req.user.userId);
    else texto = await ejecutarBalance(req.user.userId);
    res.json({ texto });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener metricas' });
  }
});

// ── Agenda ──
app.get('/api/agenda', authMiddleware, requierePermiso('ver_agenda'), async (req, res) => {
  try {
    const fecha = req.query.fecha || fechaHoyStr();
    const turnos = await obtenerTurnosPorFecha(req.user.userId, fecha);
    res.json({ turnos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agenda', authMiddleware, requierePermiso('editar_agenda'), async (req, res) => {
  try {
    const { hora, cliente, servicio, profesional, fecha } = req.body || {};
    if (!cliente) return res.status(400).json({ error: 'cliente es requerido' });
    const idTurno = await crearTurno(req.user.userId, { hora, cliente, servicio, profesional, fecha });
    res.status(201).json({ ok: true, idTurno });
  } catch (err) {
    logger.error('API', 'Error POST /api/agenda', { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/agenda/:idTurno', authMiddleware, requierePermiso('editar_agenda'), async (req, res) => {
  try {
    await eliminarTurno(req.user.userId, req.params.idTurno);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'turno_no_encontrado') return res.status(404).json({ error: 'Turno no encontrado' });
    logger.error('API', 'Error DELETE /api/agenda', { err: err.message });
    res.status(500).json({ error: 'Error al eliminar turno' });
  }
});

app.patch('/api/agenda/:idTurno', authMiddleware, requierePermiso('editar_agenda'), async (req, res) => {
  try {
    const { idTurno } = req.params;
    const { cliente, servicio, profesional, hora } = req.body || {};
    if (!cliente && !servicio && !profesional && !hora) {
      return res.status(400).json({ error: 'Al menos un campo es requerido' });
    }
    await actualizarDatosTurno(req.user.userId, idTurno, { cliente, servicio, profesional, hora });
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'turno_no_encontrado') return res.status(404).json({ error: 'Turno no encontrado' });
    logger.error('API', 'Error PATCH /api/agenda', { err: err.message });
    res.status(500).json({ error: 'Error al actualizar turno' });
  }
});

app.post('/api/agenda/:idTurno/llego', authMiddleware, requierePermiso('editar_agenda'), async (req, res) => {
  try {
    const { idTurno } = req.params;

    const turno = await obtenerTurnoPorId(req.user.userId, idTurno);
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });

    await actualizarEstadoTurno(req.user.userId, idTurno, 'Llegó');

    // Se espera el aviso para poder decirle al dashboard si le llegó al
    // profesional o por qué no (antes fallaba en silencio: .catch(() => {})).
    let notificacion;
    try {
      const tenantId = turno.profesional ? await resolveTenantId(req.user.userId) : null;
      notificacion = await notificarLlegadaPaciente(tenantId, turno.profesional, turno.cliente, turno.hora, turno.servicio);
    } catch (err) {
      logger.error('API', 'Error avisando llegada al profesional', { err: err.message });
      notificacion = { ok: false, error: 'envio_fallido' };
    }

    res.json({ ok: true, notificacion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// cobrado crea movimientos de plata → requiere cargar_movimientos, no solo editar_agenda
app.patch('/api/agenda/:idTurno/cobrado', authMiddleware, requierePermiso('cargar_movimientos'), async (req, res) => {
  try {
    const { idTurno } = req.params;
    const { montoTotal, pagos, moneda = 'Pesos' } = req.body;

    if (!montoTotal || Number(montoTotal) <= 0) return res.status(400).json({ error: 'montoTotal requerido' });
    if (!Array.isArray(pagos) || pagos.length === 0) return res.status(400).json({ error: 'pagos requerido' });
    if (pagos.some(p => !p.metodoPago || !p.monto || Number(p.monto) <= 0)) {
      return res.status(400).json({ error: 'cada pago necesita metodoPago y monto' });
    }

    const montoPagado = pagos.reduce((acc, p) => acc + Number(p.monto), 0);
    if (montoPagado > Number(montoTotal) + 0.01) {
      return res.status(400).json({ error: 'la suma de los pagos supera el monto total' });
    }
    const saldoPendiente = Math.max(0, Number(montoTotal) - montoPagado);

    const turno = await obtenerTurnoPorId(req.user.userId, idTurno);
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });

    const descripcion = `${turno.servicio || 'Turno'} - ${turno.cliente || 'Paciente'}`;
    for (const pago of pagos) {
      await guardarMovimiento(req.user.userId, {
        descripcion, monto: Number(pago.monto), tipo: 'Ingreso', moneda, metodoPago: pago.metodoPago,
        estado: 'Cobrado', pacienteNombre: turno.cliente || null,
        profesionalNombre: turno.profesional || null, tratamientoNombre: turno.servicio || null,
        referenciaId: idTurno, origenCarga: 'dashboard',
      });
    }
    if (saldoPendiente > 0.01) {
      await guardarMovimiento(req.user.userId, {
        descripcion, monto: saldoPendiente, tipo: 'Ingreso', moneda, metodoPago: '',
        estado: 'Pendiente', pacienteNombre: turno.cliente || null,
        profesionalNombre: turno.profesional || null, tratamientoNombre: turno.servicio || null,
        referenciaId: idTurno, origenCarga: 'dashboard',
      });
    }

    const estadoFinal = saldoPendiente > 0.01 ? 'Llegó' : 'Cobrado';
    await actualizarEstadoTurno(req.user.userId, idTurno, estadoFinal);
    invalidarCacheMovimientos(req.user.userId);
    logger.audit('movimiento_created', { userId: req.user.userId, montoPagado, saldoPendiente, tipo: 'Ingreso', idTurno });

    res.json({ ok: true, estadoFinal, saldoPendiente });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agenda/:idTurno/cancelar', authMiddleware, requierePermiso('editar_agenda'), async (req, res) => {
  try {
    const turno = await obtenerTurnoPorId(req.user.userId, req.params.idTurno);
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });
    await actualizarEstadoTurno(req.user.userId, req.params.idTurno, 'Cancelado');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agenda/:idTurno/novino', authMiddleware, requierePermiso('editar_agenda'), async (req, res) => {
  try {
    const turno = await obtenerTurnoPorId(req.user.userId, req.params.idTurno);
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });
    await actualizarEstadoTurno(req.user.userId, req.params.idTurno, 'No vino');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Accesos: gestión de permisos por el dueño del consultorio ──
app.get('/api/accesos', authMiddleware, ownerOnly, (req, res) => {
  const { DEFAULT_PERMISOS: DEF, ADMIN_PERMISOS: ADM } = require('../auth/permisos');
  const ownerKey = String(req.user.userId);
  const owner = clienteService.clientes[ownerKey];
  if (!owner) return res.status(404).json({ error: 'Perfil no encontrado' });

  const miembros = [{
    userId: ownerKey,
    email: owner.email || null,
    isOwner: true,
    permisos: ADM,
    preset: 'admin',
  }];

  for (const guestId of owner.usuarios || []) {
    const guestKey = String(guestId);
    const perms = (owner.permisos || {})[guestKey] || DEF;
    miembros.push({
      userId: guestKey,
      email: null,
      isOwner: false,
      permisos: perms,
      preset: detectarPreset(perms),
    });
  }

  res.json({ miembros, permisosDisponibles: PERMISOS, presets: PRESETS });
});

app.put('/api/accesos/:userId/permisos', authMiddleware, ownerOnly, async (req, res) => {
  const ownerKey = String(req.user.userId);
  const targetKey = String(req.params.userId);

  // El dueño no puede auto-editarse
  if (targetKey === ownerKey) return res.status(400).json({ error: 'No podés editar los permisos del dueño' });

  const owner = clienteService.clientes[ownerKey];
  if (!owner) return res.status(404).json({ error: 'Perfil no encontrado' });

  const esInvitado = (owner.usuarios || []).map(String).includes(targetKey);
  if (!esInvitado) return res.status(404).json({ error: 'Usuario no es miembro de este consultorio' });

  const { permisos } = req.body;
  if (!validarPermisos(permisos)) {
    return res.status(400).json({ error: 'Permisos inválidos', permisosValidos: PERMISOS });
  }

  try {
    await guardarPermisos(ownerKey, targetKey, permisos);
    logger.audit('permisos_updated', { adminId: ownerKey, targetId: targetKey, permisos });
    res.json({ ok: true, permisos, preset: detectarPreset(permisos) });
  } catch (err) {
    logger.error('API', 'Error PUT /api/accesos', { err: err.message });
    res.status(500).json({ error: 'Error al guardar permisos' });
  }
});

// ── Finanzas personales ──
// Ámbito separado del consultorio: vive en sus propias pestañas del Sheet y no
// pasa por el modelo de movimientos clínicos.

const MES_REGEX = /^\d{4}-\d{2}$/;

// Las categorías salen del servicio, no de una lista repetida en el front: si
// se agrega una, aparece sola en la UI y sigue validando igual en el POST.
// ── Comprobantes (fotos/PDFs de facturas y transferencias) ──
// Salen de la pestaña Comprobantes del sheet del consultorio. Los del ámbito
// personal son solo del dueño/admin, igual que el resto de /api/personal.
function esDuenoOAdmin(userId) {
  const cliente = obtenerClientePorUserId(Number(userId));
  return Boolean(cliente?.isOwner || esAdminOriginal(userId));
}

function comprobantePublico(c) {
  return {
    id: c.id,
    tipo: c.tipo,
    ambito: c.ambito,
    emisor: c.emisor,
    cuit: c.cuit,
    tipoComprobante: c.tipoComprobante,
    numero: c.numero,
    fechaEmision: c.fechaEmision,
    fechaVencimiento: c.fechaVencimiento,
    fechaCarga: c.fechaCarga,
    total: c.total,
    moneda: c.moneda,
    idMovimiento: c.idMovimiento,
    items: c.items,
    tieneArchivo: Boolean(c.archivo),
    mimeType: c.mimeType,
  };
}

async function comprobantesVisibles(userId) {
  const comprobanteService = require('../services/comprobante.service');
  const todos = await comprobanteService.listarComprobantes(userId);
  const dueno = esDuenoOAdmin(userId);
  return todos.filter(c => dueno || c.ambito !== 'personal');
}

app.get('/api/comprobantes', authMiddleware, requierePermiso('ver_movimientos'), async (req, res) => {
  try {
    const lista = await comprobantesVisibles(req.user.userId);
    res.json({ comprobantes: lista.map(comprobantePublico) });
  } catch (err) {
    logger.error('API', 'Error GET /api/comprobantes', { err: err.message });
    res.status(500).json({ error: 'Error al obtener comprobantes' });
  }
});

app.get('/api/comprobantes/:id/archivo', authMiddleware, requierePermiso('ver_movimientos'), async (req, res) => {
  try {
    const c = (await comprobantesVisibles(req.user.userId)).find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'Comprobante no encontrado' });
    if (!c.archivo) return res.status(404).json({ error: 'Este comprobante no tiene archivo guardado' });

    const { descargarArchivo } = require('../services/comprobante-archivo.service');
    const buffer = await descargarArchivo(req.user.userId, c.archivo);
    if (!buffer) return res.status(404).json({ error: 'No se pudo recuperar el archivo' });

    logger.audit('comprobante_archivo_visto', { userId: req.user.userId, id: c.id });
    res.setHeader('Content-Type', c.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', 'inline');
    res.send(buffer);
  } catch (err) {
    logger.error('API', 'Error GET /api/comprobantes/:id/archivo', { err: err.message });
    res.status(500).json({ error: 'Error al obtener el archivo' });
  }
});

// ── Subir comprobante desde el dashboard (fase 4 de PLAN_COMPROBANTES.md) ──
// Dos pasos, igual que en Telegram: 1) se sube el archivo y se lee con IA
// (/leer devuelve lo leído para que el usuario lo revise); 2) el usuario
// confirma (con sus correcciones) y se guarda. Lo leído queda del lado del
// servidor (TTL): del cliente solo se aceptan los campos editables, nunca el
// hash, el archivo ni los datos fiscales.
const MIME_COMPROBANTE = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const subidaComprobante = express.raw({ type: MIME_COMPROBANTE, limit: config.MAX_PHOTO_SIZE_BYTES || 10 * 1024 * 1024 });

function fechaIsoADdmm(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function fechaDdmmAIso(ddmm) {
  const m = String(ddmm || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function comprobanteParaCliente(c) {
  const { hash, archivo, mimeType, ...resto } = c || {};
  return resto;
}

// Ámbito de un comprobante leído (consultorio / personal), con el mismo detector
// que el bot. Solo el dueño o el admin tienen Personal; para el resto queda
// consultorio. Modifica `entities` en el lugar.
async function detectarAmbitoComprobante(userId, entities, texto) {
  entities.ambito = 'consultorio';
  if (!esDuenoOAdmin(userId)) return;
  const { resolverAmbito, inferirCategoriaPersonal } = require('../services/personal-nlp.service');
  const preferencias = await personalService.leerPreferencias(userId).catch(() => ({}));
  if (resolverAmbito(texto, { preferencias }).ambito === 'personal') {
    entities.ambito = 'personal';
    entities.categoriaConsultorio = entities.categoria;
    entities.categoria = inferirCategoriaPersonal('gasto', texto);
  }
}

app.post('/api/comprobantes/leer', authMiddleware, requierePermiso('cargar_movimientos'), subidaComprobante, async (req, res) => {
  const userId = req.user.userId;
  const tipo = req.query.tipo === 'transferencia' ? 'transferencia' : 'factura';
  const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!MIME_COMPROBANTE.includes(mimeType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'Mandá una foto (JPG, PNG, WEBP) o un PDF' });
  }

  const aiQuota = require('../lib/ai-quota');
  const cuota = aiQuota.consumir(userId, 'media');
  if (!cuota.ok) {
    return res.status(429).json({ error: `Se alcanzó el límite diario de lectura de fotos del consultorio (${cuota.limite}). Mañana se renueva.` });
  }

  try {
    const comprobanteService = require('../services/comprobante.service');
    const vision = require('../services/comprobante-vision.service');
    const archivoService = require('../services/comprobante-archivo.service');
    const { geminiMediaSemaphore } = require('../lib/semaphore');
    const buffer = req.body;
    const hash = comprobanteService.hashArchivo(buffer);
    const idComprobante = comprobanteService.generarIdComprobante();

    const resultado = await geminiMediaSemaphore.run(() => (tipo === 'transferencia'
      ? vision.extraerTransferencia(buffer, mimeType)
      : vision.extraerFactura(buffer, mimeType)));

    if (!resultado) return res.status(422).json({ error: 'No se pudo leer el comprobante. Probá con una foto más clara y derecha.' });
    if (resultado.error === 'vision_no_configurada' || resultado.error === 'vision_dependencia_faltante') {
      return res.status(503).json({ error: 'La lectura de imágenes no está configurada en el servidor.' });
    }
    if (resultado.error) {
      return res.status(422).json({ error: tipo === 'transferencia' ? 'No parece un comprobante de transferencia.' : 'No parece una factura ni un ticket.' });
    }

    let entities;
    let pendientes = [];
    if (tipo === 'transferencia') {
      const t = resultado.transferencia;
      if (!t.monto) return res.status(422).json({ error: 'Leí el comprobante pero no encontré el monto.' });
      const dup = comprobanteService.datosDuplicadoTransferencia(t);
      const duplicado = await comprobanteService.buscarDuplicado(userId, { hash, cuit: dup.cuit, emisor: dup.emisor, numero: t.numeroOperacion, total: t.monto });
      entities = comprobanteService.transferenciaAEntities(t, {
        idComprobante, hash, mimeType,
        duplicado: duplicado ? { motivo: duplicado.motivo, fechaCarga: duplicado.comprobante.fechaCarga } : null,
      });
      if (t.direccion === 'enviada') {
        // Egreso: no hay pendientes de un paciente que cobrar. Mismo detector de
        // ámbito que una factura (solo el dueño tiene Personal).
        await detectarAmbitoComprobante(userId, entities, comprobanteService.textoParaAmbitoTransferencia(t));
      } else try {
        const cmd = require('../services/command.service');
        const { getRowIdUnico, getRowDescripcion, getRowMonto, getRowMoneda, getRowFecha } = require('../utils/sheet-row');
        const filas = await cmd.buscarPendientesDePagador(userId, t.pagador, { moneda: t.moneda });
        pendientes = filas.map(f => ({
          idUnico: getRowIdUnico(f, ''),
          descripcion: getRowDescripcion(f, ''),
          monto: Math.abs(getRowMonto(f, 0)),
          moneda: getRowMoneda(f, 'Pesos'),
          fecha: getRowFecha(f, ''),
        })).filter(p => p.idUnico);
      } catch (err) {
        logger.warn('API', 'No se pudieron buscar pendientes del pagador', { err: err.message });
      }
    } else {
      const f = resultado.factura;
      if (!f.total) return res.status(422).json({ error: 'Leí el comprobante pero no encontré el total.' });
      const duplicado = await comprobanteService.buscarDuplicado(userId, { hash, cuit: f.cuit, emisor: f.emisor, numero: f.numero, total: f.total });
      entities = comprobanteService.facturaAEntities(f, {
        idComprobante,
        duplicado: duplicado ? { motivo: duplicado.motivo, fechaCarga: duplicado.comprobante.fechaCarga } : null,
      });
      entities.comprobante.hash = hash;
      entities.comprobante.mimeType = mimeType;
      // Mismo detector de ámbito que el bot; solo el dueño tiene Personal.
      await detectarAmbitoComprobante(userId, entities, comprobanteService.textoParaAmbito(f));
    }

    archivoService.recordarArchivo(idComprobante, { buffer, mimeType });
    state.pendingComprobantesDashboard.set(idComprobante, {
      userId: String(userId), tipo, entities, pendientes: pendientes.map(p => p.idUnico),
    });

    logger.audit('comprobante_leido_dashboard', { userId, idComprobante, tipo });
    res.json({
      idComprobante,
      tipo,
      comprobante: comprobanteParaCliente(entities.comprobante),
      sugerido: {
        descripcion: entities.descripcion || '',
        monto: Math.abs(Number(entities.monto) || 0),
        moneda: entities.moneda || 'Pesos',
        metodoPago: entities.metodo_pago || '',
        estado: entities.estado || 'Cobrado',
        categoria: entities.categoria || '',
        proveedor: entities.proveedorNombre || '',
        paciente: entities.pacienteNombre || '',
        fechaVencimiento: fechaDdmmAIso(entities.fechaVencimiento),
        ambito: entities.ambito,
      },
      pendientes,
      puedePersonal: esDuenoOAdmin(userId) && (tipo === 'factura' || entities.direccionTransferencia === 'enviada'),
      tipoMovimiento: String(entities.tipo || '').toLowerCase() === 'gasto' ? 'egreso' : 'ingreso',
    });
  } catch (err) {
    if (err.code === 'SEMAPHORE_QUEUE_FULL') return res.status(503).json({ error: 'Estoy leyendo varias imágenes. Probá de nuevo en unos segundos.' });
    logger.error('API', 'Error POST /api/comprobantes/leer', { err: err.message });
    res.status(500).json({ error: 'Error al leer el comprobante' });
  }
});

app.post('/api/comprobantes', authMiddleware, requierePermiso('cargar_movimientos'), async (req, res) => {
  const userId = req.user.userId;
  const body = req.body || {};
  const pend = state.pendingComprobantesDashboard.get(String(body.idComprobante || ''));
  if (!pend || pend.userId !== String(userId)) {
    return res.status(410).json({ error: 'El comprobante leído expiró. Subilo de nuevo.' });
  }

  try {
    const registro = require('../services/comprobante-registro.service');
    const entities = { ...pend.entities, comprobante: { ...pend.entities.comprobante } };
    const m = body.movimiento || {};

    const desc = normalizarDescripcion(m.descripcion);
    if (!desc.ok) return res.status(400).json({ error: 'La descripción es inválida' });
    const monto = validarMonto(m.monto);
    if (!monto.ok) return res.status(400).json({ error: 'El monto es inválido' });
    const vto = validarFechaOpcional(m.fechaVencimiento);
    if (!vto.ok) return res.status(400).json({ error: 'La fecha de vencimiento es inválida' });

    entities.descripcion = desc.valor;
    entities.monto = Math.abs(monto.valor);
    entities.moneda = ['Dólares', 'Euros'].includes(m.moneda) ? m.moneda : 'Pesos';
    entities.metodo_pago = ['efectivo', 'transferencia', 'tarjeta'].includes(m.metodoPago) ? m.metodoPago : null;
    entities.estado = m.estado === 'Pendiente' ? 'Pendiente' : 'Cobrado';
    if (m.categoria !== undefined) entities.categoria = sanitizarInput(m.categoria, 40) || entities.categoria;
    if (m.proveedor !== undefined) entities.proveedorNombre = sanitizarInput(m.proveedor, 100) || null;
    if (m.paciente !== undefined) entities.pacienteNombre = sanitizarInput(m.paciente, 100) || null;
    entities.fechaVencimiento = vto.valor ? fechaIsoADdmm(vto.valor) : null;
    // Personal vale para facturas y para transferencias ENVIADAS (egresos); una recibida es un cobro del consultorio.
    const admitePersonal = pend.tipo === 'factura' || pend.entities.direccionTransferencia === 'enviada';
    entities.ambito = m.ambito === 'personal' && admitePersonal && esDuenoOAdmin(userId) ? 'personal' : 'consultorio';

    // Transferencia que cobra un pendiente que ya existía.
    if (pend.tipo === 'transferencia' && body.cobrarIdUnico) {
      if (!pend.pendientes.includes(body.cobrarIdUnico)) return res.status(400).json({ error: 'Pendiente inválido' });
      const cmd = require('../services/command.service');
      const { getRowIdUnico } = require('../utils/sheet-row');
      const filas = await cmd.buscarPendientesDePagador(userId, entities.pagadorNombre || entities.pacienteNombre, { moneda: entities.moneda, limite: 20 });
      const fila = filas.find(f => getRowIdUnico(f, '') === body.cobrarIdUnico);
      if (!fila) return res.status(409).json({ error: 'Ese pendiente ya no está pendiente. Recargá y probá de nuevo.' });
      const { mensaje, idMovimiento } = await registro.cobrarPendienteConTransferencia(userId, fila, entities, { respaldoTelegram: true });
      state.pendingComprobantesDashboard.delete(body.idComprobante);
      invalidarCacheMovimientos(userId);
      logger.audit('comprobante_guardado_dashboard', { userId, idComprobante: body.idComprobante, cobro: true });
      return res.status(201).json({ ok: true, idComprobante: body.idComprobante, idMovimiento, mensaje: mensaje.replace(/[*_`]/g, '') });
    }

    let idMovimiento = null;
    if (entities.ambito === 'personal') {
      const { movimiento } = await personalService.registrarMovimientoPersonal(userId, {
        descripcion: entities.descripcion,
        monto: entities.monto,
        tipo: 'gasto',
        moneda: entities.moneda,
        metodoPago: entities.metodo_pago,
        categoria: entities.categoria,
        comercio: entities.comprobante.emisor || null,
        fecha: entities.fecha || undefined,
        notas: entities.referenciaId,
        origenCarga: 'dashboard',
      });
      idMovimiento = movimiento.idMov;
    } else {
      // Una factura es siempre egreso; una transferencia, según su dirección (enviada = egreso).
      const esEgreso = pend.tipo === 'factura' || pend.entities.direccionTransferencia === 'enviada';
      if ((entities.moneda === 'Dólares' && !state.cotizacionDolar) || (entities.moneda === 'Euros' && !state.cotizacionEuro)) {
        await obtenerCotizacionDolar();
      }
      const resultado = await guardarMovimiento(userId, {
        descripcion: entities.descripcion,
        monto: esEgreso ? -entities.monto : entities.monto,
        tipo: esEgreso ? 'Egreso' : 'Ingreso',
        moneda: entities.moneda,
        metodoPago: entities.metodo_pago || '',
        estado: entities.estado,
        categoria: entities.categoria || null,
        pacienteNombre: esEgreso ? null : entities.pacienteNombre,
        pagadorNombre: esEgreso ? null : (entities.pagadorNombre || entities.pacienteNombre),
        proveedorNombre: esEgreso ? entities.proveedorNombre : null,
        fechaPrestacion: entities.fechaPrestacion || entities.fecha || null,
        fechaVencimiento: entities.fechaVencimiento,
        referenciaId: entities.referenciaId,
        origenCarga: 'dashboard',
      });
      idMovimiento = resultado && resultado.idUnico;
    }

    await registro.registrarComprobanteCompleto(userId, entities, { idMovimiento, respaldoTelegram: true });
    state.pendingComprobantesDashboard.delete(body.idComprobante);
    invalidarCacheMovimientos(userId);
    logger.audit('comprobante_guardado_dashboard', { userId, idComprobante: body.idComprobante, ambito: entities.ambito });
    res.status(201).json({ ok: true, idComprobante: body.idComprobante, idMovimiento });
  } catch (err) {
    if (err.message === 'monto_invalido') return res.status(400).json({ error: 'El monto es inválido' });
    if (err.message === 'descripcion_invalida') return res.status(400).json({ error: 'La descripción es inválida' });
    logger.error('API', 'Error POST /api/comprobantes', { err: err.message });
    res.status(500).json({ error: 'Error al guardar el comprobante' });
  }
});

app.get('/api/personal/categorias', authMiddleware, ownerOnly, (req, res) => {
  res.json({
    egreso: CATEGORIAS_EGRESO_PERSONAL,
    ingreso: CATEGORIAS_INGRESO_PERSONAL,
  });
});

// Un solo request trae todo lo que la vista Personal necesita (totales, por
// categoría, presupuestos y viaje activo), en vez de encadenar cuatro.
app.get('/api/personal/resumen', authMiddleware, ownerOnly, async (req, res) => {
  try {
    const mes = MES_REGEX.test(String(req.query.mes || '')) ? String(req.query.mes) : undefined;
    const resumen = await personalService.calcularResumenPersonal(req.user.userId, mes);
    res.json(resumen);
  } catch (err) {
    logger.error('API', 'Error GET /api/personal/resumen', { err: err.message });
    res.status(500).json({ error: 'Error al obtener el resumen personal' });
  }
});

app.get('/api/personal/movimientos', authMiddleware, ownerOnly, async (req, res) => {
  try {
    const movimientos = await personalService.obtenerMovimientosPersonales(req.user.userId);
    res.json({ movimientos });
  } catch (err) {
    logger.error('API', 'Error GET /api/personal/movimientos', { err: err.message });
    res.status(500).json({ error: 'Error al obtener movimientos personales' });
  }
});

app.post('/api/personal/movimientos', authMiddleware, ownerOnly, async (req, res) => {
  try {
    const body = req.body || {};

    const descripcionValidada = normalizarDescripcion(body.descripcion);
    if (!descripcionValidada.ok) return res.status(400).json({ error: 'La descripción es inválida' });

    const montoValidado = validarMonto(body.monto);
    if (!montoValidado.ok) return res.status(400).json({ error: 'El monto es inválido' });

    const tipo = body.tipo === 'Ingreso' ? 'ingreso' : 'gasto';
    const categoria = normalizarCategoriaPersonal(body.categoria);
    if (!categoria) return res.status(400).json({ error: 'La categoría no es válida para el ámbito personal' });

    const moneda = ['Dolares', 'Dólares'].includes(body.moneda) ? 'Dólares'
      : body.moneda === 'Euros' ? 'Euros' : 'Pesos';
    const metodoPago = ['efectivo', 'transferencia', 'tarjeta', 'debito'].includes(body.metodoPago)
      ? body.metodoPago : null;

    if ((moneda === 'Dólares' && !state.cotizacionDolar) || (moneda === 'Euros' && !state.cotizacionEuro)) {
      await obtenerCotizacionDolar();
    }

    const { movimiento } = await personalService.registrarMovimientoPersonal(req.user.userId, {
      descripcion: descripcionValidada.valor,
      monto: Math.abs(montoValidado.valor),
      tipo,
      moneda,
      metodoPago,
      categoria,
      comercio: sanitizarInput(body.comercio, 100) || null,
      notas: sanitizarInput(body.notas, 200) || null,
      origenCarga: 'web',
    });

    res.status(201).json({ movimiento });
  } catch (err) {
    if (err.message === 'monto_invalido') return res.status(400).json({ error: 'El monto es inválido' });
    if (err.message === 'descripcion_invalida') return res.status(400).json({ error: 'La descripción es inválida' });
    logger.error('API', 'Error POST /api/personal/movimientos', { err: err.message });
    res.status(500).json({ error: 'Error al guardar el movimiento personal' });
  }
});

app.delete('/api/personal/movimientos/:idMov', authMiddleware, ownerOnly, async (req, res) => {
  try {
    const eliminado = await personalService.eliminarMovimientoPersonal(req.user.userId, req.params.idMov);
    if (!eliminado) return res.status(404).json({ error: 'Movimiento no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    logger.error('API', 'Error DELETE /api/personal/movimientos', { err: err.message });
    res.status(500).json({ error: 'Error al eliminar el movimiento personal' });
  }
});

app.get('/api/personal/presupuestos', authMiddleware, ownerOnly, async (req, res) => {
  try {
    const presupuestos = await personalService.obtenerPresupuestos(req.user.userId);
    res.json({ presupuestos });
  } catch (err) {
    logger.error('API', 'Error GET /api/personal/presupuestos', { err: err.message });
    res.status(500).json({ error: 'Error al obtener presupuestos' });
  }
});

// Upsert por categoría. Monto 0 desactiva el presupuesto sin borrar el registro.
app.put('/api/personal/presupuestos', authMiddleware, ownerOnly, async (req, res) => {
  try {
    const body = req.body || {};
    const categoria = normalizarCategoriaPersonal(body.categoria);
    if (!categoria) return res.status(400).json({ error: 'La categoría no es válida' });

    const monto = Number(body.montoMensual);
    if (!Number.isFinite(monto) || monto < 0) return res.status(400).json({ error: 'El monto es inválido' });

    const moneda = ['Dolares', 'Dólares'].includes(body.moneda) ? 'Dólares'
      : body.moneda === 'Euros' ? 'Euros' : 'Pesos';

    const presupuesto = await personalService.guardarPresupuesto(req.user.userId, categoria, monto, moneda);
    res.json({ presupuesto });
  } catch (err) {
    logger.error('API', 'Error PUT /api/personal/presupuestos', { err: err.message });
    res.status(500).json({ error: 'Error al guardar el presupuesto' });
  }
});

app.get('/api/personal/viajes', authMiddleware, ownerOnly, async (req, res) => {
  try {
    const viaje = await personalService.obtenerViajeActivo(req.user.userId);
    // `_row` es la fila del Sheet: no debe salir por la API.
    res.json({ viaje: viaje ? { ...viaje, _row: undefined } : null });
  } catch (err) {
    logger.error('API', 'Error GET /api/personal/viajes', { err: err.message });
    res.status(500).json({ error: 'Error al obtener el viaje activo' });
  }
});

app.post('/api/personal/viajes', authMiddleware, ownerOnly, async (req, res) => {
  try {
    const body = req.body || {};
    const nombre = sanitizarInput(body.nombre, 80);
    if (!nombre) return res.status(400).json({ error: 'El nombre del viaje es obligatorio' });

    const activo = await personalService.obtenerViajeActivo(req.user.userId);
    if (activo) return res.status(409).json({ error: 'Ya hay un viaje activo. Cerralo primero.' });

    // El front manda YYYY-MM-DD; el Sheet guarda DD/MM/YYYY.
    const desde = validarFechaOpcional(body.fechaInicio);
    if (!desde.ok) return res.status(400).json({ error: 'La fecha de inicio es inválida' });
    const hasta = validarFechaOpcional(body.fechaFin);
    if (!hasta.ok) return res.status(400).json({ error: 'La fecha de fin es inválida' });

    const isoADdmmyyyy = (iso) => {
      if (!iso) return '';
      const [a, m, d] = iso.split('-');
      return `${d}/${m}/${a}`;
    };

    const viaje = await personalService.crearViaje(req.user.userId, {
      nombre,
      fechaInicio: isoADdmmyyyy(desde.valor),
      fechaFin: isoADdmmyyyy(hasta.valor),
      presupuesto: Number.isFinite(Number(body.presupuesto)) && Number(body.presupuesto) > 0
        ? Number(body.presupuesto) : null,
    });

    res.status(201).json({ viaje });
  } catch (err) {
    logger.error('API', 'Error POST /api/personal/viajes', { err: err.message });
    res.status(500).json({ error: 'Error al crear el viaje' });
  }
});

app.post('/api/personal/viajes/cerrar', authMiddleware, ownerOnly, async (req, res) => {
  try {
    const cerrado = await personalService.cerrarViaje(req.user.userId);
    if (!cerrado) return res.status(404).json({ error: 'No hay ningún viaje activo' });
    res.json({ ok: true, viaje: { ...cerrado, _row: undefined } });
  } catch (err) {
    logger.error('API', 'Error POST /api/personal/viajes/cerrar', { err: err.message });
    res.status(500).json({ error: 'Error al cerrar el viaje' });
  }
});

// ── Casas compartidas (gastos entre varias personas) ──
// Control de acceso por membresía a cada casa (casa.service), no ownerOnly.
require('./casa.routes').registrarRutasCasa(app, { authMiddleware, obtenerCotizacionDolar });

// ── Cotizacion (publica) ──
app.get('/api/cotizacion', (req, res) => {
  res.json({ dolar: state.cotizacionDolar, euro: state.cotizacionEuro, fecha: state.cotizacionFecha });
});

// ── Servir dashboard estatico (produccion) ──
const DIST = path.join(__dirname, '../../dashboard/dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, {
    etag: true,
    maxAge: '7d',
    index: false,
    setHeaders: (res, filePath) => {
      // Los assets llevan hash en el nombre, así que se pueden cachear fuerte.
      // index.html y el service worker NO: si el navegador cachea sw.js 7 días,
      // la PWA instalada sigue sirviendo la versión vieja mucho después del
      // deploy, y el usuario no ve los cambios aunque estén publicados.
      const base = path.basename(filePath);
      if (base === 'index.html' || base === 'sw.js' || base === 'registerSW.js') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  app.get('/{*path}', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(DIST, 'index.html'));
    }
  });
}

function warnIfDevTokenMisconfigured() {
  if (process.env.DASHBOARD_DEV_TOKEN && process.env.NODE_ENV !== 'development') {
    logger.warn('API', 'DASHBOARD_DEV_TOKEN está seteado pero NODE_ENV no es "development" — el login con dev token queda deshabilitado. Si no la usás, quitala.');
  }
}

function startApi() {
  warnIfDevTokenMisconfigured();
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      logger.info('API', `Escuchando en http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

module.exports = { app, startApi, authMiddleware, firmarSesion, armarSesion, SESSION_MAX_SEC, JWT_SECRET, warnIfDevTokenMisconfigured, authCodes };

// Arranque standalone (`node src/api/index.js`, sin el bot) — también espera
// a que termine de cargar clientes.json/Supabase antes de atender requests.
if (require.main === module) clienteService.listo.then(() => startApi());
