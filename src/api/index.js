const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { notificarLlegadaPaciente } = require('../services/profesional.service');
const { getSupabase, isAvailable } = require('../lib/supabase');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const { obtenerDatosSheet } = require('../services/sheet.service');
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
const {
  obtenerTurnosPorFecha,
  obtenerTurnoPorId,
  actualizarEstadoTurno,
  actualizarDatosTurno,
  eliminarTurno,
  fechaHoyStr,
} = require('../services/agenda.service');
const clienteService = require('../services/cliente.service');
const { sanitizarInput } = require('../utils/formatter');
const { normalizarDescripcion, validarMonto } = require('../utils/validation');
const { obtenerCotizacionDolar } = require('../services/cotizacion.service');
const eventsService = require('../services/events.service');
const state = require('../state');
const logger = require('../lib/logger');
const { createLimiter } = require('../lib/rate-limiter');

const app = express();

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

const PORT = process.env.DASHBOARD_API_PORT || process.env.PORT || 3001;
const JWT_SECRET = config.JWT_SECRET;

const SESSION_DURATION = '180d';
const SESSION_REFRESH_THRESHOLD_SEC = 30 * 24 * 60 * 60; // renovar si quedan menos de 30 dias

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // Sesion deslizante: si al usuario le queda poco tiempo de token, le mandamos
    // uno nuevo en la respuesta para que el dashboard nunca le pida re-login
    // mientras siga usandolo dentro de la ventana de SESSION_DURATION.
    if (decoded.exp && decoded.exp - Date.now() / 1000 < SESSION_REFRESH_THRESHOLD_SEC) {
      const refreshed = jwt.sign({ userId: decoded.userId, type: decoded.type }, JWT_SECRET, { expiresIn: SESSION_DURATION });
      res.setHeader('X-Refreshed-Token', refreshed);
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

// Rate limiting de las rutas de auth: doble clave (IP + telegramId) para que
// no sea bypasseable variando solo una de las dos.
const requestCodeByIp   = createLimiter({ windowMs: 10 * 60 * 1000, max: 20 });
const requestCodeByUser = createLimiter({ windowMs: 10 * 60 * 1000, max: 5 });
const verifyByIp        = createLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
const verifyByUser      = createLimiter({ windowMs: 10 * 60 * 1000, max: 10 });

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
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  if (isAvailable() && getSupabase()) {
    try {
      await getSupabase().from('auth_codes').upsert(
        { telegram_user_id: telegramId, code, expires_at: expiresAt.toISOString(), used: false },
        { onConflict: 'telegram_user_id' }
      );
    } catch (err) {
      logger.warn('AUTH', 'No se pudo persistir auth_code en Supabase', { telegramId, err: err.message });
    }
  }
  if (!global._authCodes) global._authCodes = new Map();
  global._authCodes.set(telegramId, { code, expiresAt, used: false });

  try {
    const { bot } = require('../lib/telegraf');
    await bot.telegram.sendMessage(Number(telegramId),
      `🔐 Codigo de acceso a Cashy Dashboard:\n\n*${code}*\n\nVence en 24 horas.`,
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
  if (DEV_TOKEN && code === DEV_TOKEN) {
    const token = jwt.sign({ userId: telegramId, type: 'dashboard' }, JWT_SECRET, { expiresIn: SESSION_DURATION });
    const cliente = obtenerClientePorUserId(Number(telegramId));
    const esAdmin = esAdminOriginal(Number(telegramId));
    logger.audit('auth_dev_token_login', { telegramId });
    return res.json({ token, user: { userId: telegramId, isAdmin: esAdmin, email: cliente?.email || null, sheetId: esAdmin ? config.SPREADSHEET_ID : (cliente?.sheetId || null) } });
  }

  let codeData = null;
  if (global._authCodes?.has(telegramId)) {
    codeData = global._authCodes.get(telegramId);
  } else if (isAvailable() && getSupabase()) {
    const { data } = await getSupabase().from('auth_codes').select('*').eq('telegram_user_id', telegramId).maybeSingle();
    if (data) codeData = { code: data.code, expiresAt: new Date(data.expires_at), used: data.used };
  }

  if (!codeData) {
    logger.audit('auth_verify_failed', { telegramId, reason: 'no_code_requested' });
    return res.status(400).json({ error: 'No hay codigo solicitado para este usuario' });
  }
  if (codeData.used) {
    logger.audit('auth_verify_failed', { telegramId, reason: 'code_already_used' });
    return res.status(400).json({ error: 'Codigo ya utilizado' });
  }
  if (new Date() > codeData.expiresAt) {
    logger.audit('auth_verify_failed', { telegramId, reason: 'code_expired' });
    return res.status(400).json({ error: 'Codigo expirado' });
  }
  if (codeData.code !== code) {
    logger.audit('auth_verify_failed', { telegramId, reason: 'code_incorrect' });
    return res.status(400).json({ error: 'Codigo incorrecto' });
  }

  codeData.used = true;
  if (global._authCodes?.has(telegramId)) global._authCodes.set(telegramId, codeData);
  if (isAvailable() && getSupabase()) {
    try {
      await getSupabase().from('auth_codes').update({ used: true }).eq('telegram_user_id', telegramId);
    } catch (err) {
      logger.warn('AUTH', 'No se pudo marcar auth_code como usado en Supabase', { telegramId, err: err.message });
    }
  }

  const token = jwt.sign({ userId: telegramId, type: 'dashboard' }, JWT_SECRET, { expiresIn: SESSION_DURATION });
  const cliente = obtenerClientePorUserId(Number(telegramId));
  const esAdmin = esAdminOriginal(Number(telegramId));
  logger.audit('auth_verify_success', { telegramId, esAdmin });
  res.json({ token, user: { userId: telegramId, isAdmin: esAdmin, email: cliente?.email || null, sheetId: esAdmin ? config.SPREADSHEET_ID : (cliente?.sheetId || null) } });
});

// ── Auth: me ──
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const cliente = obtenerClientePorUserId(Number(req.user.userId));
  const esAdmin = esAdminOriginal(Number(req.user.userId));
  res.json({ user: { userId: req.user.userId, isAdmin: esAdmin, email: cliente?.email || null, sheetId: esAdmin ? config.SPREADSHEET_ID : (cliente?.sheetId || null) } });
});

// ── Cache de movimientos (30s) ──
const _movCache = new Map();
const MOV_CACHE_TTL = 30 * 1000;

async function getDatosConCache(userId) {
  const cached = _movCache.get(userId);
  if (cached && Date.now() - cached.ts < MOV_CACHE_TTL) return cached.data;
  const data = await obtenerDatosSheet(userId);
  _movCache.set(userId, { data, ts: Date.now() });
  return data;
}

function invalidarCacheMovimientos(userId) { _movCache.delete(String(userId)); }

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
app.get('/api/movimientos', authMiddleware, async (req, res) => {
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
app.post('/api/movimientos', authMiddleware, async (req, res) => {
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
app.put('/api/movimientos/:idUnico', authMiddleware, async (req, res) => {
  try {
    const { idUnico } = req.params;
    const body = req.body || {};
    const updates = {};
    if (body.descripcion !== undefined) updates.descripcion = String(body.descripcion).trim();
    if (body.monto       !== undefined) updates.monto       = parseFloat(body.monto);
    if (body.estado      !== undefined) updates.estado      = ['Cobrado', 'Pendiente'].includes(body.estado) ? body.estado : undefined;
    if (body.metodoPago  !== undefined) updates.metodoPago  = body.metodoPago || '';
    if (body.moneda      !== undefined) updates.moneda      = ['Pesos', 'Dólares', 'Euros'].includes(body.moneda) ? body.moneda : undefined;
    Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No hay campos validos para actualizar' });

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
app.delete('/api/movimientos/:idUnico', authMiddleware, async (req, res) => {
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
app.delete('/api/movimientos-by-key', authMiddleware, async (req, res) => {
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

// ── Profesionales ──
app.get('/api/profesionales', authMiddleware, async (req, res) => {
  try {
    const datos = await obtenerDatosSheet(req.user.userId);
    const set = new Set();
    datos.forEach(d => { if (d.profesional) set.add(d.profesional); });
    res.json({ profesionales: Array.from(set) });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener profesionales' });
  }
});

// ── Metrics ──
app.get('/api/metrics', authMiddleware, async (req, res) => {
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
app.get('/api/agenda', authMiddleware, async (req, res) => {
  try {
    const fecha = req.query.fecha || fechaHoyStr();
    const turnos = await obtenerTurnosPorFecha(req.user.userId, fecha);
    res.json({ turnos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/agenda/:idTurno', authMiddleware, async (req, res) => {
  try {
    await eliminarTurno(req.user.userId, req.params.idTurno);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'turno_no_encontrado') return res.status(404).json({ error: 'Turno no encontrado' });
    logger.error('API', 'Error DELETE /api/agenda', { err: err.message });
    res.status(500).json({ error: 'Error al eliminar turno' });
  }
});

app.patch('/api/agenda/:idTurno', authMiddleware, async (req, res) => {
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

app.post('/api/agenda/:idTurno/llego', authMiddleware, async (req, res) => {
  try {
    const { idTurno } = req.params;
    const { monto, metodoPago, moneda = 'Pesos' } = req.body;
    if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'monto requerido' });

    const turno = await obtenerTurnoPorId(req.user.userId, idTurno);
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });

    await actualizarEstadoTurno(req.user.userId, idTurno, 'Cobrado');
    await guardarMovimiento(req.user.userId, {
      descripcion: `${turno.servicio || 'Turno'} - ${turno.cliente || 'Paciente'}`,
      monto: Number(monto), tipo: 'Ingreso', moneda, metodoPago: metodoPago || '',
      estado: 'Cobrado', pacienteNombre: turno.cliente || null,
      profesionalNombre: turno.profesional || null, tratamientoNombre: turno.servicio || null,
      referenciaId: idTurno, origenCarga: 'dashboard',
    });
    invalidarCacheMovimientos(req.user.userId);
    logger.audit('movimiento_created', { userId: req.user.userId, monto: Number(monto), tipo: 'Ingreso', idTurno });

    if (turno.profesional) {
      notificarLlegadaPaciente(turno.profesional, turno.cliente, turno.hora, turno.servicio).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/agenda/:idTurno/cobrado', authMiddleware, async (req, res) => {
  try {
    const { idTurno } = req.params;
    const { monto, metodoPago, moneda = 'Pesos' } = req.body;
    if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'monto requerido' });

    const turno = await obtenerTurnoPorId(req.user.userId, idTurno);
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });

    await actualizarEstadoTurno(req.user.userId, idTurno, 'Cobrado');
    await guardarMovimiento(req.user.userId, {
      descripcion: `${turno.servicio || 'Turno'} - ${turno.cliente || 'Paciente'}`,
      monto: Number(monto), tipo: 'Ingreso', moneda, metodoPago: metodoPago || '',
      estado: 'Cobrado', pacienteNombre: turno.cliente || null,
      profesionalNombre: turno.profesional || null, tratamientoNombre: turno.servicio || null,
      referenciaId: idTurno, origenCarga: 'dashboard',
    });
    logger.audit('movimiento_created', { userId: req.user.userId, monto: Number(monto), tipo: 'Ingreso', idTurno });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
      if (filePath.endsWith('index.html')) {
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

function startApi() {
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      logger.info('API', `Escuchando en http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

module.exports = { app, startApi, authMiddleware, JWT_SECRET };

if (require.main === module) startApi();
