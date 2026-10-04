// API de CASA (gastos compartidos). Se registra desde src/api/index.js.
//
// El control de acceso NO es ownerOnly: un miembro de la casa puede no ser
// quien la creó. Cada ruta que toca una casa pasa por casa.service, cuyo
// control de membresía (obtenerCasaParaMiembro) mira el perfil del usuario Y el
// sheet de la casa. Lo que sale de acá no incluye ids de Telegram de otras
// personas ni el dueño del sheet: solo ids de miembro propios de la casa.

const casaService = require('../services/casa.service');
const casaInvite = require('../services/casa-invite.service');
const { mensajeErrorPlano } = require('../lib/casa-format');
const { normalizarDescripcion, validarMonto } = require('../utils/validation');
const { sanitizarInput } = require('../utils/formatter');
const { normalizarCategoriaPersonal, CATEGORIAS_EGRESO_PERSONAL } = require('../services/personal-nlp.service');
const { obtenerClientePorUserId } = require('../auth');
const { fechaStrAIso } = require('../utils/date');
const state = require('../state');
const logger = require('../lib/logger');

const MES_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_REGEX = /^[A-Za-z0-9_]{1,64}$/;
const METODOS = ['efectivo', 'transferencia', 'tarjeta', 'debito'];

const STATUS_POR_CODIGO = {
  no_miembro: 403,
  solo_duenos: 403,
  sin_cuenta: 403,
  solo_creador: 403,
  sin_permiso: 403,
  casa_inexistente: 404,
  miembro_inexistente: 404,
  nombre_repetido: 409,
  ya_miembro: 409,
  saldo_pendiente: 409,
  miembro_no_disponible: 409,
};

function responderError(res, err, contexto) {
  if (err instanceof casaService.CasaError) {
    return res.status(STATUS_POR_CODIGO[err.code] || 400).json({ error: mensajeErrorPlano(err), code: err.code });
  }
  logger.error('API', `Error ${contexto}`, { err: err.message });
  return res.status(500).json({ error: 'Error interno' });
}

// Vistas de salida: solo lo que el dashboard necesita.
const vistaMiembro = (m) => ({ id: m.id, nombre: m.nombre, esVirtual: !m.userId, rol: m.rol });

const vistaMovimiento = (m, { userId, esCreador }) => ({
  idMov: m.idMov,
  fecha: m.fecha,
  hora: m.hora,
  tipo: m.tipo,
  descripcion: m.descripcion,
  monto: m.monto,
  moneda: m.moneda,
  montoPesos: m.montoPesos,
  metodoPago: m.metodoPago,
  categoria: m.categoria,
  pagoPor: m.pagoPor,
  repartoEntre: m.repartoEntre,
  para: m.para,
  notas: m.notas,
  puedoBorrar: esCreador || m.idOrigen === String(userId),
});

const normalizarMoneda = (m) => (['Dolares', 'Dólares'].includes(m) ? 'Dólares' : (m === 'Euros' ? 'Euros' : 'Pesos'));

// "2026-10-05" o "05/10/2026" -> "05/10/2026" (formato del Sheet) | null si no es válida
function fechaParaSheet(valor) {
  const iso = fechaStrAIso(valor);
  if (!iso) return null;
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function registrarRutasCasa(app, { authMiddleware, obtenerCotizacionDolar }) {
  const ids = (req, res, next) => {
    if (!ID_REGEX.test(String(req.params.casaId || ''))) return res.status(400).json({ error: 'Casa inválida' });
    next();
  };
  const uid = (req) => req.user.userId;

  // Categorías disponibles para cargar un gasto de casa.
  app.get('/api/casa/categorias', authMiddleware, (req, res) => {
    res.json({ egreso: CATEGORIAS_EGRESO_PERSONAL });
  });

  // Mis casas (solo lo mínimo).
  app.get('/api/casa', authMiddleware, (req, res) => {
    try {
      const activa = casaService.getCasaActiva(uid(req));
      const casas = casaService.listarMisCasas(uid(req)).map((c) => ({
        casaId: c.casaId,
        nombre: c.nombre,
        activa: Boolean(activa && activa.casaId === c.casaId),
      }));
      res.json({ casas });
    } catch (err) {
      responderError(res, err, 'GET /api/casa');
    }
  });

  app.post('/api/casa', authMiddleware, async (req, res) => {
    try {
      const body = req.body || {};
      const cliente = obtenerClientePorUserId(Number(uid(req)));
      const alias = sanitizarInput(body.alias, 40) || (cliente && cliente.email ? cliente.email.split('@')[0] : 'Yo');
      const c = await casaService.crearCasa(uid(req), sanitizarInput(body.nombre, 40), { alias });
      res.status(201).json({ casa: { casaId: c.casaId, nombre: c.nombre, activa: true } });
    } catch (err) {
      responderError(res, err, 'POST /api/casa');
    }
  });

  // Canjear un código de invitación (el mismo que /unir en el bot).
  app.post('/api/casa/unir', authMiddleware, async (req, res) => {
    try {
      const body = req.body || {};
      const inv = casaInvite.buscarInvitacionCasa(uid(req), body.codigo, { tieneCuenta: true });
      if (inv.estado === 'bloqueado') return res.status(429).json({ error: 'Demasiados intentos con códigos inválidos. Probá más tarde.' });
      if (inv.estado !== 'casa') return res.status(400).json({ error: 'Código inválido o expirado' });

      const cliente = obtenerClientePorUserId(Number(uid(req)));
      const alias = sanitizarInput(body.alias, 40) || (cliente && cliente.email ? cliente.email.split('@')[0] : 'Yo');
      const { casa } = await casaService.unirMiembro(uid(req), {
        ownerId: inv.data.ownerId, casaId: inv.data.casaId, miembroId: inv.data.miembroId, alias,
      });
      casaInvite.consumirInvitacionCasa(uid(req), inv.codigo);
      res.status(201).json({ casa: { casaId: casa.casaId, nombre: casa.nombre } });
    } catch (err) {
      responderError(res, err, 'POST /api/casa/unir');
    }
  });

  app.post('/api/casa/:casaId/activar', authMiddleware, ids, async (req, res) => {
    try {
      await casaService.setCasaActiva(uid(req), req.params.casaId);
      res.json({ ok: true });
    } catch (err) {
      responderError(res, err, 'POST /api/casa/:id/activar');
    }
  });

  // Un solo request trae lo que la vista necesita (como /api/personal/resumen).
  app.get('/api/casa/:casaId/resumen', authMiddleware, ids, async (req, res) => {
    try {
      const mes = MES_REGEX.test(String(req.query.mes || '')) ? String(req.query.mes) : undefined;
      const r = await casaService.calcularResumenCasa(uid(req), req.params.casaId, mes);
      const ctxVista = { userId: uid(req), esCreador: r.esCreador };
      res.json({
        casa: { casaId: r.casa.casaId, nombre: r.casa.nombre },
        mes: r.mes,
        yo: { id: r.yo.id, nombre: r.yo.nombre },
        esCreador: r.esCreador,
        miembros: r.miembros.map(vistaMiembro),
        gastosPorMoneda: r.gastosPorMoneda,
        porCategoria: Object.entries(r.porCategoria)
          .map(([categoria, total]) => ({ categoria, total }))
          .sort((a, b) => b.total - a.total),
        cantidad: r.cantidad,
        movimientos: r.movimientos.map((m) => vistaMovimiento(m, ctxVista)),
        saldos: r.saldos,
      });
    } catch (err) {
      responderError(res, err, 'GET /api/casa/:id/resumen');
    }
  });

  app.get('/api/casa/:casaId/saldos', authMiddleware, ids, async (req, res) => {
    try {
      const { saldos } = await casaService.calcularSaldosCasa(uid(req), req.params.casaId);
      res.json({ saldos });
    } catch (err) {
      responderError(res, err, 'GET /api/casa/:id/saldos');
    }
  });

  app.get('/api/casa/:casaId/movimientos', authMiddleware, ids, async (req, res) => {
    try {
      const ctx = await casaService.obtenerCasaParaMiembro(uid(req), req.params.casaId);
      const mes = MES_REGEX.test(String(req.query.mes || '')) ? String(req.query.mes) : undefined;
      const movs = await casaService.listarMovimientos(uid(req), req.params.casaId, { mes });
      res.json({ movimientos: movs.map((m) => vistaMovimiento(m, { userId: uid(req), esCreador: ctx.esCreador })) });
    } catch (err) {
      responderError(res, err, 'GET /api/casa/:id/movimientos');
    }
  });

  app.post('/api/casa/:casaId/movimientos', authMiddleware, ids, async (req, res) => {
    try {
      const body = req.body || {};

      const descripcion = normalizarDescripcion(body.descripcion);
      if (!descripcion.ok) return res.status(400).json({ error: 'La descripción es inválida' });

      const monto = validarMonto(body.monto);
      if (!monto.ok) return res.status(400).json({ error: 'El monto es inválido' });

      let categoria = 'otros';
      if (body.categoria) {
        categoria = normalizarCategoriaPersonal(body.categoria);
        if (!categoria) return res.status(400).json({ error: 'La categoría no es válida' });
      }

      let fecha;
      if (body.fecha) {
        fecha = fechaParaSheet(body.fecha);
        if (!fecha) return res.status(400).json({ error: 'La fecha es inválida' });
      }

      const moneda = normalizarMoneda(body.moneda);
      const metodoPago = METODOS.includes(body.metodoPago) ? body.metodoPago : '';
      if ((moneda === 'Dólares' && !state.cotizacionDolar) || (moneda === 'Euros' && !state.cotizacionEuro)) {
        await obtenerCotizacionDolar();
      }

      const repartoEntre = Array.isArray(body.repartoEntre)
        ? body.repartoEntre.map(String).filter(Boolean)
        : undefined;
      if (repartoEntre && repartoEntre.length > 50) return res.status(400).json({ error: 'El reparto es inválido' });

      const { movimiento } = await casaService.registrarGasto(uid(req), req.params.casaId, {
        descripcion: descripcion.valor,
        monto: Math.abs(monto.valor),
        moneda,
        metodoPago,
        categoria,
        fecha,
        pagoPor: body.pagoPor ? String(body.pagoPor) : undefined,
        repartoEntre,
        notas: sanitizarInput(body.notas, 200) || '',
      });
      res.status(201).json({ movimiento: { idMov: movimiento.idMov } });
    } catch (err) {
      responderError(res, err, 'POST /api/casa/:id/movimientos');
    }
  });

  app.delete('/api/casa/:casaId/movimientos/:idMov', authMiddleware, ids, async (req, res) => {
    try {
      if (!ID_REGEX.test(String(req.params.idMov || ''))) return res.status(400).json({ error: 'Movimiento inválido' });
      const ok = await casaService.eliminarMovimiento(uid(req), req.params.casaId, req.params.idMov);
      if (!ok) return res.status(404).json({ error: 'Movimiento no encontrado' });
      res.json({ ok: true });
    } catch (err) {
      responderError(res, err, 'DELETE /api/casa/:id/movimientos');
    }
  });

  // Registrar que alguien le pagó a otro para saldar deuda.
  app.post('/api/casa/:casaId/liquidaciones', authMiddleware, ids, async (req, res) => {
    try {
      const body = req.body || {};
      const monto = validarMonto(body.monto);
      if (!monto.ok) return res.status(400).json({ error: 'El monto es inválido' });
      const { movimiento } = await casaService.registrarLiquidacion(uid(req), req.params.casaId, {
        de: body.de ? String(body.de) : undefined,
        para: String(body.para || ''),
        monto: Math.abs(monto.valor),
        moneda: normalizarMoneda(body.moneda),
      });
      res.status(201).json({ movimiento: { idMov: movimiento.idMov } });
    } catch (err) {
      responderError(res, err, 'POST /api/casa/:id/liquidaciones');
    }
  });

  app.get('/api/casa/:casaId/miembros', authMiddleware, ids, async (req, res) => {
    try {
      const ctx = await casaService.obtenerCasaParaMiembro(uid(req), req.params.casaId);
      res.json({
        miembros: ctx.miembros.filter((m) => m.estado === 'activo').map(vistaMiembro),
        yo: { id: ctx.yo.id, nombre: ctx.yo.nombre },
      });
    } catch (err) {
      responderError(res, err, 'GET /api/casa/:id/miembros');
    }
  });

  // Alta de alguien sin Telegram.
  app.post('/api/casa/:casaId/miembros', authMiddleware, ids, async (req, res) => {
    try {
      const m = await casaService.agregarMiembroVirtual(uid(req), req.params.casaId, sanitizarInput((req.body || {}).nombre, 40));
      res.status(201).json({ miembro: { id: m.id, nombre: m.nombre, esVirtual: true } });
    } catch (err) {
      responderError(res, err, 'POST /api/casa/:id/miembros');
    }
  });

  // Quitar a alguien (solo el creador) o salirse uno mismo.
  app.delete('/api/casa/:casaId/miembros/:miembroId', authMiddleware, ids, async (req, res) => {
    try {
      if (!ID_REGEX.test(String(req.params.miembroId || ''))) return res.status(400).json({ error: 'Miembro inválido' });
      await casaService.quitarMiembro(uid(req), req.params.casaId, req.params.miembroId);
      res.json({ ok: true });
    } catch (err) {
      responderError(res, err, 'DELETE /api/casa/:id/miembros');
    }
  });

  // Código de invitación (de un solo uso, 24 h). Con miembroId, para que otra
  // cuenta reclame a un miembro sin Telegram.
  app.post('/api/casa/:casaId/invitaciones', authMiddleware, ids, async (req, res) => {
    try {
      const ctx = await casaService.obtenerCasaParaMiembro(uid(req), req.params.casaId);
      const miembroId = (req.body || {}).miembroId ? String(req.body.miembroId) : null;
      if (miembroId) {
        const m = ctx.miembros.find((x) => x.id === miembroId && x.estado === 'activo' && !x.userId);
        if (!m) return res.status(404).json({ error: 'Ese miembro no existe o ya tiene cuenta' });
      }
      const codigo = casaInvite.crearInvitacionCasa({
        ownerId: ctx.ownerId, casaId: ctx.casa.casaId, casaNombre: ctx.casa.nombre, miembroId, creadoPor: uid(req),
      });
      logger.audit('casa_invitacion_creada', { userId: uid(req), casaId: ctx.casa.casaId, paraMiembro: Boolean(miembroId), canal: 'api' });
      res.status(201).json({ codigo, vigenciaHoras: 24 });
    } catch (err) {
      responderError(res, err, 'POST /api/casa/:id/invitaciones');
    }
  });
}

module.exports = { registrarRutasCasa, vistaMovimiento, vistaMiembro, fechaParaSheet };
