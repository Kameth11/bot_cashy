const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { getSupabase, isAvailable } = require('../lib/supabase');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const { obtenerDatosSheet } = require('../services/sheet.service');
const { ejecutarBalance, ejecutarHoy, ejecutarSemana, ejecutarMes } = require('../services/command.service');
const {
  guardarMovimiento,
  calcularMontoPesos,
} = require('../services/movimiento.service');
const {
  obtenerTurnosPorFecha,
  actualizarEstadoTurno,
  fechaHoyStr,
} = require('../services/agenda.service');

const app = express();

const ALLOWED_ORIGINS = (process.env.DASHBOARD_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    // permite requests sin origin (curl, Postman, mismo servidor)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS bloqueado: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());

const PORT = process.env.DASHBOARD_API_PORT || process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'cashy-dashboard-secret-change-in-production';

// ── Auth middleware ──
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function adminOnly(req, res, next) {
  if (!esAdminOriginal(req.user?.userId)) {
    return res.status(403).json({ error: 'Solo el administrador' });
  }
  next();
}

// ── Auth: request code via Telegram bot ──
app.post('/api/auth/request-code', async (req, res) => {
  const { userId } = req.body;
  if (!userId || isNaN(Number(userId))) {
    return res.status(400).json({ error: 'userId inválido' });
  }
  const telegramId = String(userId);

  // Validate that this userId is actually registered
  const cliente = obtenerClientePorUserId(Number(telegramId));
  const esAdmin = esAdminOriginal(Number(telegramId));

  // For development: also allow any non-empty userId
  const isRegistered = cliente || esAdmin;

  if (!isRegistered && process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ error: 'Usuario no registrado en el sistema' });
  }

  // Generate code
  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  // Store in Supabase if available
  if (isAvailable() && getSupabase()) {
    const supabase = getSupabase();
    try {
      await supabase
        .from('auth_codes')
        .upsert(
          {
            telegram_user_id: telegramId,
            code,
            expires_at: expiresAt.toISOString(),
            used: false,
          },
          { onConflict: 'telegram_user_id' }
        );
    } catch {
      // Table might not exist; fallback to memory
    }
  }

  // Always store in memory as fallback
  if (!global._authCodes) global._authCodes = new Map();
  global._authCodes.set(telegramId, { code, expiresAt, used: false });

  // Send code via Telegram bot
  try {
    const { bot } = require('../lib/telegraf');
    await bot.telegram.sendMessage(
      Number(telegramId),
      `🔐 Código de acceso a Cashy Dashboard:\n\n*${code}*\n\nVence en 24 horas. No lo compartas.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('[DASHBOARD] Error enviando código Telegram:', err.message);
    console.log(`[DASHBOARD] Código para ${telegramId}: ${code}`);
    return res.status(500).json({
      error: 'No se pudo enviar el código por Telegram. ¿Ya iniciaste el bot con /start?',
    });
  }

  res.json({ success: true, message: 'Código enviado por Telegram' });
});

// ── Auth: verify code ──
app.post('/api/auth/verify', async (req, res) => {
  const { userId, code } = req.body;
  if (!userId || !code) {
    return res.status(400).json({ error: 'userId y código son requeridos' });
  }

  const DEV_TOKEN = process.env.DASHBOARD_DEV_TOKEN;
  if (DEV_TOKEN && code === DEV_TOKEN) {
    const telegramId = String(userId);
    const token = jwt.sign({ userId: telegramId, type: 'dashboard' }, JWT_SECRET, { expiresIn: '7d' });
    const cliente = obtenerClientePorUserId(Number(telegramId));
    const esAdmin = esAdminOriginal(Number(telegramId));
    return res.json({
      token,
      user: {
        userId: telegramId,
        isAdmin: esAdmin,
        email: cliente?.email || null,
        sheetId: esAdmin ? config.SPREADSHEET_ID : (cliente?.sheetId || null),
      },
    });
  }

  const telegramId = String(userId);
  let codeData = null;

  if (global._authCodes?.has(telegramId)) {
    codeData = global._authCodes.get(telegramId);
  } else if (isAvailable() && getSupabase()) {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('auth_codes')
      .select('*')
      .eq('telegram_user_id', telegramId)
      .maybeSingle();
    if (data) {
      codeData = {
        code: data.code,
        expiresAt: new Date(data.expires_at),
        used: data.used,
      };
    }
  }

  if (!codeData) {
    return res.status(400).json({ error: 'No hay código solicitado para este usuario' });
  }
  if (codeData.used) {
    return res.status(400).json({ error: 'Código ya utilizado' });
  }
  if (new Date() > codeData.expiresAt) {
    return res.status(400).json({ error: 'Código expirado' });
  }
  if (codeData.code !== code) {
    return res.status(400).json({ error: 'Código incorrecto' });
  }

  // Mark as used
  codeData.used = true;
  if (global._authCodes?.has(telegramId)) {
    global._authCodes.set(telegramId, codeData);
  }
  if (isAvailable() && getSupabase()) {
    try {
      await getSupabase()
        .from('auth_codes')
        .update({ used: true })
        .eq('telegram_user_id', telegramId);
    } catch {
      // ignore
    }
  }

  // Issue JWT
  const token = jwt.sign({ userId: telegramId, type: 'dashboard' }, JWT_SECRET, {
    expiresIn: '7d',
  });

  // Get user info
  const cliente = obtenerClientePorUserId(Number(telegramId));
  const esAdmin = esAdminOriginal(Number(telegramId));

  res.json({
    token,
    user: {
      userId: telegramId,
      isAdmin: esAdmin,
      email: cliente?.email || null,
      sheetId: esAdmin ? config.SPREADSHEET_ID : (cliente?.sheetId || null),
    },
  });
});

// ── Auth: refresh / validate ──
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const cliente = obtenerClientePorUserId(Number(req.user.userId));
  const esAdmin = esAdminOriginal(Number(req.user.userId));
  res.json({
    user: {
      userId: req.user.userId,
      isAdmin: esAdmin,
      email: cliente?.email || null,
      sheetId: esAdmin ? config.SPREADSHEET_ID : (cliente?.sheetId || null),
    },
  });
});

// ── Movimientos: list ──
app.get('/api/movimientos', authMiddleware, async (req, res) => {
  try {
    const { tipo, estado, profesional, paciente, desde, hasta } = req.query;
    const datos = await obtenerDatosSheet(req.user.userId);

    // d.fecha viene en formato dd/mm/yyyy — normalizar a Date para comparar
    const { normalizarFecha } = require('../utils/date');
    const desdeDate = desde ? new Date(desde) : null;
    const hastaDate = hasta ? new Date(hasta) : null;

    let filtered = datos;
    if (tipo) filtered = filtered.filter(d => d.tipo === tipo);
    if (estado) filtered = filtered.filter(d => d.estado === estado);
    if (profesional) filtered = filtered.filter(d => (d.profesional || '').toLowerCase().includes(profesional.toLowerCase()));
    if (paciente) filtered = filtered.filter(d => (d.paciente || '').toLowerCase().includes(paciente.toLowerCase()));
    if (desdeDate) filtered = filtered.filter(d => {
      const f = normalizarFecha(d.fecha);
      return f && f >= desdeDate;
    });
    if (hastaDate) filtered = filtered.filter(d => {
      const f = normalizarFecha(d.fecha);
      return f && f <= hastaDate;
    });

    res.json({ movimientos: filtered });
  } catch (err) {
    console.error('Error /api/movimientos:', err);
    res.status(500).json({ error: 'Error al obtener movimientos' });
  }
});

// ── Movimientos: create ──
app.post('/api/movimientos', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const body = req.body || {};

    const descripcion = String(body.descripcion || '').trim();
    const monto = Math.abs(parseFloat(body.monto) || 0);
    const tipo = body.tipo === 'Egreso' ? 'Egreso' : 'Ingreso';
    const moneda = body.moneda === 'Dólares' ? 'Dólares'
      : body.moneda === 'Euros' ? 'Euros'
      : 'Pesos';
    const metodoPago = body.metodoPago || '';
    const estado = body.estado === 'Pendiente' ? 'Pendiente' : 'Cobrado';
    const categoria = body.categoria || '';
    const pacienteNombre = body.paciente || '';
    const profesionalNombre = body.profesional || '';
    const tratamientoNombre = body.tratamiento || '';
    const proveedorNombre = body.proveedor || '';
    const fechaPrestacion = body.fechaPrestacion || '';
    const fechaVencimiento = body.fechaVencimiento || '';

    if (!descripcion || !monto) {
      return res.status(400).json({ error: 'Descripción y monto son requeridos' });
    }

    const resultado = await guardarMovimiento(userId, {
      descripcion,
      monto,
      tipo,
      moneda,
      metodoPago,
      estado,
      categoria,
      pacienteNombre,
      profesionalNombre,
      tratamientoNombre,
      proveedorNombre,
      fechaPrestacion,
      fechaVencimiento,
    });

    if (!resultado) {
      return res.status(500).json({ error: 'No se pudo guardar el movimiento' });
    }

    res.status(201).json({ movimiento: resultado });
  } catch (err) {
    console.error('Error /api/movimientos POST:', err);
    res.status(500).json({ error: 'Error al guardar movimiento' });
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

// ── Stats / metrics ──
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
    res.status(500).json({ error: 'Error al obtener métricas' });
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

app.post('/api/agenda/:idTurno/llego', authMiddleware, async (req, res) => {
  try {
    const { idTurno } = req.params;
    const fecha = fechaHoyStr();
    const turnos = await obtenerTurnosPorFecha(req.user.userId, fecha);
    const turno = turnos.find(t => t.idTurno === idTurno);

    await actualizarEstadoTurno(req.user.userId, idTurno, 'Llegó');

    try {
      const { bot } = require('../lib/telegraf');
      const lineas = [
        `🔔 *Llegó el paciente*`,
        `👤 ${turno?.cliente || 'Sin nombre'}`,
        turno?.hora ? `⏰ ${turno.hora}` : null,
        turno?.profesional ? `👨‍⚕️ ${turno.profesional}` : null,
        turno?.servicio ? `🦷 ${turno.servicio}` : null,
      ].filter(Boolean).join('\n');
      await bot.telegram.sendMessage(config.AUTHORIZED_USER_ID, lineas, { parse_mode: 'Markdown' });
    } catch (tgErr) {
      console.error('Error Telegram llego:', tgErr.message);
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

    if (!monto || Number(monto) <= 0) {
      return res.status(400).json({ error: 'monto requerido' });
    }

    const fecha = fechaHoyStr();
    const turnos = await obtenerTurnosPorFecha(req.user.userId, fecha);
    const turno = turnos.find(t => t.idTurno === idTurno);
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });

    await actualizarEstadoTurno(req.user.userId, idTurno, 'Cobrado');

    await guardarMovimiento(req.user.userId, {
      descripcion: `${turno.servicio || 'Turno'} - ${turno.cliente || 'Paciente'}`,
      monto: Number(monto),
      tipo: 'Ingreso',
      moneda,
      metodoPago: metodoPago || '',
      estado: 'Cobrado',
      pacienteNombre: turno.cliente || null,
      profesionalNombre: turno.profesional || null,
      tratamientoNombre: turno.servicio || null,
      referenciaId: idTurno,
      origenCarga: 'dashboard',
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cotizacion (public) ──
app.get('/api/cotizacion', (req, res) => {
  const state = require('../state');
  res.json({
    dolar: state.cotizacionDolar,
    euro: state.cotizacionEuro,
    fecha: state.cotizacionFecha,
  });
});

// ── Servir dashboard estático (producción) ──
const DIST = path.join(__dirname, '../../dashboard/dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('/{*path}', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(DIST, 'index.html'));
    }
  });
}

// ── Start API server ──
function startApi() {
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`API escuchando en http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

module.exports = { app, startApi, authMiddleware, JWT_SECRET };

if (require.main === module) startApi();
