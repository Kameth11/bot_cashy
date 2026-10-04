// Casas compartidas: gastos entre varias personas con "quién pagó", "entre
// quiénes se reparte" y saldos (ver lib/casa-saldos.js).
//
// DÓNDE VIVEN LOS DATOS: en pestañas (Casas, CasaMiembros, CasaMovimientos) del
// spreadsheet de la cuenta que creó la casa (`ownerId`). Sheets es la fuente de
// verdad; no hay tablas de Supabase en esta versión. Cada miembro guarda en su
// perfil un índice [{ casaId, ownerId, nombre }] (cliente.service getCasas).
//
// SEGURIDAD: esto es compartir datos ENTRE cuentas a propósito, así que hay un
// único punto de acceso, `obtenerCasaParaMiembro`: toma el ownerId del perfil
// del usuario (dato del servidor, nunca del request) y además verifica en el
// propio sheet que el usuario figure como miembro activo. Todo lo demás pasa
// por ahí. Un miembro dado de baja pierde el acceso aunque su perfil no se
// haya limpiado.
//
// ESCRITURAS: bajo withOwnerWriteLock(ownerId): serializa con las escrituras
// del dueño del sheet y de los demás miembros (que son de otras cuentas).

const { getOrCreateTabConReintento } = require('./sheet-tab.service');
const { withOwnerWriteLock } = require('../lib/write-queue');
const { obtenerClientePorUserId } = require('../auth');
const clienteService = require('./cliente.service');
const { convertirAPesos } = require('./movimiento.service');
const { calcularSaldos } = require('../lib/casa-saldos');
const { fechaArgentinaStr, horaArgentinaStr, ahoraArgentina, fechaStrAIso } = require('../utils/date');
const { emitMovimientosUpdated } = require('./events.service');
const logger = require('../lib/logger');

const TAB_CASAS = 'Casas';
const TAB_MIEMBROS = 'CasaMiembros';
const TAB_MOVIMIENTOS = 'CasaMovimientos';

const COLS = {
  [TAB_CASAS]: ['ID_Casa', 'Nombre', 'CreadaPor', 'Creada', 'Estado'],
  [TAB_MIEMBROS]: ['ID_Casa', 'ID_Miembro', 'UserId', 'Nombre', 'Rol', 'Estado', 'Alta'],
  [TAB_MOVIMIENTOS]: [
    'ID_Mov', 'ID_Casa', 'Fecha', 'Hora', 'Tipo', 'Descripcion', 'Monto', 'Moneda',
    'MontoPesos', 'MetodoPago', 'Categoria', 'PagoPor', 'RepartoEntre', 'Para', 'Notas',
    'ID_Origen',
  ],
};

const MONEDAS = ['Pesos', 'Dólares', 'Euros'];
const NOMBRE_MIN = 2;
const NOMBRE_MAX = 40;

class CasaError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'CasaError';
    this.code = code;
  }
}

// ── Utilidades ───────────────────────────────────────────────────────────────

const generarId = (prefijo) => `${prefijo}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

function normalizarNombre(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function validarNombre(valor, campo) {
  const nombre = String(valor || '').trim().replace(/\s+/g, ' ');
  if (nombre.length < NOMBRE_MIN || nombre.length > NOMBRE_MAX) {
    throw new CasaError(`${campo}_invalido`, `El ${campo} debe tener entre ${NOMBRE_MIN} y ${NOMBRE_MAX} caracteres`);
  }
  return nombre;
}

function mesActualIso() {
  const now = ahoraArgentina();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function tab(ownerId, titulo) {
  const sheet = await getOrCreateTabConReintento(ownerId, titulo, COLS[titulo]);
  if (!sheet) throw new CasaError('sin_sheet', 'No se pudo acceder al sheet de la casa');
  return sheet;
}

function rowToCasa(r) {
  return {
    casaId: String(r.get('ID_Casa') || ''),
    nombre: String(r.get('Nombre') || ''),
    creadaPor: String(r.get('CreadaPor') || ''),
    creada: String(r.get('Creada') || ''),
    estado: String(r.get('Estado') || 'activa'),
  };
}

function rowToMiembro(r) {
  return {
    casaId: String(r.get('ID_Casa') || ''),
    id: String(r.get('ID_Miembro') || ''),
    userId: String(r.get('UserId') || ''),
    nombre: String(r.get('Nombre') || ''),
    rol: String(r.get('Rol') || 'miembro'),
    estado: String(r.get('Estado') || 'activo'),
    alta: String(r.get('Alta') || ''),
  };
}

function rowToMovimiento(r) {
  const reparto = String(r.get('RepartoEntre') || '');
  return {
    idMov: String(r.get('ID_Mov') || ''),
    casaId: String(r.get('ID_Casa') || ''),
    fecha: String(r.get('Fecha') || ''),
    hora: String(r.get('Hora') || ''),
    tipo: String(r.get('Tipo') || 'gasto'),
    descripcion: String(r.get('Descripcion') || ''),
    monto: Number(String(r.get('Monto') || '').replace(',', '.')) || 0,
    moneda: String(r.get('Moneda') || 'Pesos'),
    montoPesos: Number(String(r.get('MontoPesos') || '').replace(',', '.')) || 0,
    metodoPago: String(r.get('MetodoPago') || ''),
    categoria: String(r.get('Categoria') || ''),
    pagoPor: String(r.get('PagoPor') || ''),
    repartoEntre: reparto ? reparto.split(',').map((x) => x.trim()).filter(Boolean) : [],
    para: String(r.get('Para') || ''),
    notas: String(r.get('Notas') || ''),
    idOrigen: String(r.get('ID_Origen') || ''),
  };
}

async function leerMiembros(ownerId, casaId) {
  const rows = await (await tab(ownerId, TAB_MIEMBROS)).getRows();
  return rows.map(rowToMiembro).filter((m) => m.casaId === casaId);
}

async function leerCasaRow(ownerId, casaId) {
  const rows = await (await tab(ownerId, TAB_CASAS)).getRows();
  const fila = rows.find((r) => String(r.get('ID_Casa') || '') === casaId);
  return fila ? rowToCasa(fila) : null;
}

// ── Acceso: ÚNICO punto de control de membresía ──────────────────────────────

// Casas de la cuenta (índice en su perfil, en memoria). Vacío si no tiene.
function listarMisCasas(userId) {
  return clienteService.getCasas(userId) || [];
}

/**
 * Devuelve la casa, sus miembros y el miembro que es `userId`, o tira
 * CasaError('no_miembro' | 'casa_inexistente'). TODO acceso a datos de una casa
 * tiene que pasar por acá.
 */
async function obtenerCasaParaMiembro(userId, casaId) {
  const id = String(casaId || '');
  const entrada = listarMisCasas(userId).find((c) => c.casaId === id);
  if (!entrada) throw new CasaError('no_miembro', 'No pertenecés a esa casa');

  const ownerId = String(entrada.ownerId);
  const casa = await leerCasaRow(ownerId, id);
  if (!casa) throw new CasaError('casa_inexistente', 'La casa ya no existe');

  const miembros = await leerMiembros(ownerId, id);
  const yo = miembros.find((m) => m.userId === String(userId) && m.estado === 'activo');
  if (!yo) throw new CasaError('no_miembro', 'No pertenecés a esa casa');

  return { casa, miembros, ownerId, yo, esCreador: yo.rol === 'creador' };
}

const activos = (miembros) => miembros.filter((m) => m.estado === 'activo');

// Avisa a los dashboards abiertos de los miembros que la casa cambió (SSE).
// Best-effort: un fallo acá nunca debe romper la operación que ya se guardó.
function notificarMiembros(miembros) {
  for (const m of activos(miembros || [])) {
    if (!m.userId) continue;
    try { emitMovimientosUpdated(m.userId); } catch (_) { /* sin dashboard abierto */ }
  }
}

// Casa "activa" de la cuenta: la que se usa cuando el texto no nombra ninguna.
// Se guarda como marca en el índice del perfil (persiste con el resto). Si no
// hay marca (o la casa activa se dejó), la primera.
function getCasaActiva(userId) {
  const casas = listarMisCasas(userId);
  if (casas.length === 0) return null;
  return casas.find((c) => c.activa) || casas[0];
}

async function setCasaActiva(userId, casaId) {
  const casas = listarMisCasas(userId);
  if (!casas.some((c) => c.casaId === String(casaId))) throw new CasaError('no_miembro', 'No pertenecés a esa casa');
  await clienteService.setCasas(userId, casas.map((c) => ({ ...c, activa: c.casaId === String(casaId) })));
}

// Agrega una casa al índice del perfil y la deja como activa.
const conCasaActiva = (casas, nueva) => [...casas.map((c) => ({ ...c, activa: false })), { ...nueva, activa: true }];

// ── Casas y miembros ─────────────────────────────────────────────────────────

async function crearCasa(userId, nombre, { alias } = {}) {
  const cliente = obtenerClientePorUserId(userId);
  if (!cliente || !cliente.isOwner) {
    throw new CasaError('solo_duenos', 'Solo una cuenta propia puede crear una casa');
  }
  const actuales = clienteService.getCasas(userId);
  if (actuales === null) throw new CasaError('sin_cuenta', 'Tu cuenta no tiene perfil propio');

  const nombreCasa = validarNombre(nombre, 'nombre');
  const aliasCreador = validarNombre(alias || 'Yo', 'alias');
  if (actuales.some((c) => normalizarNombre(c.nombre) === normalizarNombre(nombreCasa))) {
    throw new CasaError('nombre_repetido', 'Ya tenés una casa con ese nombre');
  }

  const ownerId = String(cliente.ownerId);
  const casaId = generarId('casa');
  const miembroId = generarId('mb');
  const ahora = `${fechaArgentinaStr()} ${horaArgentinaStr()}`;

  const casasSheet = await tab(ownerId, TAB_CASAS);
  const miembrosSheet = await tab(ownerId, TAB_MIEMBROS);
  await withOwnerWriteLock(ownerId, async () => {
    await casasSheet.addRow({ ID_Casa: casaId, Nombre: nombreCasa, CreadaPor: String(userId), Creada: ahora, Estado: 'activa' });
    await miembrosSheet.addRow({
      ID_Casa: casaId, ID_Miembro: miembroId, UserId: String(userId), Nombre: aliasCreador,
      Rol: 'creador', Estado: 'activo', Alta: ahora,
    });
  });

  await clienteService.setCasas(userId, conCasaActiva(actuales, { casaId, ownerId, nombre: nombreCasa }));
  logger.audit('casa_creada', { userId, casaId, nombre: nombreCasa });
  return { casaId, ownerId, nombre: nombreCasa, miembroId };
}

async function listarMiembros(userId, casaId) {
  const { miembros } = await obtenerCasaParaMiembro(userId, casaId);
  return activos(miembros);
}

// Alta de un miembro sin Telegram (hijos, etc.): solo participa del reparto.
async function agregarMiembroVirtual(userId, casaId, nombre) {
  const ctx = await obtenerCasaParaMiembro(userId, casaId);
  const { ownerId } = ctx;
  const nombreMiembro = validarNombre(nombre, 'nombre');
  const sheet = await tab(ownerId, TAB_MIEMBROS);

  return withOwnerWriteLock(ownerId, async () => {
    // Se relee DENTRO del lock: dos altas simultáneas con el mismo nombre no
    // tienen que colarse las dos.
    const existentes = (await sheet.getRows()).map(rowToMiembro).filter((m) => m.casaId === casaId);
    if (activos(existentes).some((m) => normalizarNombre(m.nombre) === normalizarNombre(nombreMiembro))) {
      throw new CasaError('nombre_repetido', 'Ya hay un miembro con ese nombre');
    }
    const id = generarId('mb');
    await sheet.addRow({
      ID_Casa: casaId, ID_Miembro: id, UserId: '', Nombre: nombreMiembro,
      Rol: 'miembro', Estado: 'activo', Alta: `${fechaArgentinaStr()} ${horaArgentinaStr()}`,
    });
    notificarMiembros(ctx.miembros);
    logger.audit('casa_miembro_virtual_agregado', { userId, casaId, miembroId: id });
    return { id, nombre: nombreMiembro, userId: '' };
  });
}

/**
 * Una cuenta se une a una casa (canje de invitación). `ownerId` y `casaId`
 * vienen del código de invitación guardado en el servidor. Si trae `miembroId`
 * de un miembro virtual, la cuenta lo reclama (conserva su historial);
 * si no, se crea un miembro nuevo con `alias`.
 */
async function unirMiembro(userId, { ownerId, casaId, miembroId = null, alias }) {
  const cliente = obtenerClientePorUserId(userId);
  if (!cliente || !cliente.isOwner) {
    throw new CasaError('solo_duenos', 'Solo una cuenta propia puede unirse a una casa');
  }
  const actuales = clienteService.getCasas(userId);
  if (actuales === null) throw new CasaError('sin_cuenta', 'Tu cuenta no tiene perfil propio');

  const owner = String(ownerId);
  const id = String(casaId);
  const casa = await leerCasaRow(owner, id);
  if (!casa) throw new CasaError('casa_inexistente', 'La casa ya no existe');

  const sheet = await tab(owner, TAB_MIEMBROS);
  const miembro = await withOwnerWriteLock(owner, async () => {
    const existentes = (await sheet.getRows());
    const propios = existentes.filter((r) => String(r.get('ID_Casa') || '') === id);
    if (propios.some((r) => String(r.get('UserId') || '') === String(userId) && String(r.get('Estado') || 'activo') === 'activo')) {
      throw new CasaError('ya_miembro', 'Ya pertenecés a esa casa');
    }

    if (miembroId) {
      const fila = propios.find((r) => String(r.get('ID_Miembro') || '') === String(miembroId));
      if (!fila || String(fila.get('Estado') || 'activo') !== 'activo' || String(fila.get('UserId') || '')) {
        throw new CasaError('miembro_no_disponible', 'Esa invitación ya no está disponible');
      }
      fila.set('UserId', String(userId));
      await fila.save();
      return { id: String(miembroId), nombre: String(fila.get('Nombre') || '') };
    }

    const nombre = validarNombre(alias, 'alias');
    const miembros = propios.map(rowToMiembro);
    if (activos(miembros).some((m) => normalizarNombre(m.nombre) === normalizarNombre(nombre))) {
      throw new CasaError('nombre_repetido', 'Ya hay un miembro con ese nombre');
    }
    const nuevoId = generarId('mb');
    await sheet.addRow({
      ID_Casa: id, ID_Miembro: nuevoId, UserId: String(userId), Nombre: nombre,
      Rol: 'miembro', Estado: 'activo', Alta: `${fechaArgentinaStr()} ${horaArgentinaStr()}`,
    });
    return { id: nuevoId, nombre };
  });

  if (!actuales.some((c) => c.casaId === id)) {
    await clienteService.setCasas(userId, conCasaActiva(actuales, { casaId: id, ownerId: owner, nombre: casa.nombre }));
  }
  try { notificarMiembros(await leerMiembros(owner, id)); } catch (_) { /* best-effort */ }
  logger.audit('casa_miembro_unido', { userId, casaId: id, miembroId: miembro.id });
  return { casa, miembro };
}

// Baja de un miembro (queda en el historial con Estado=baja para que sus
// gastos y saldos pasados sigan calculándose). Solo el creador puede dar de
// baja a otros; cualquiera puede salirse. No se puede si tiene saldo
// pendiente, ni dar de baja al creador.
async function quitarMiembro(userId, casaId, miembroId) {
  const ctx = await obtenerCasaParaMiembro(userId, casaId);
  const objetivo = ctx.miembros.find((m) => m.id === String(miembroId) && m.estado === 'activo');
  if (!objetivo) throw new CasaError('miembro_inexistente', 'No existe ese miembro');

  const esSalida = objetivo.id === ctx.yo.id;
  if (!esSalida && !ctx.esCreador) throw new CasaError('solo_creador', 'Solo quien creó la casa puede quitar miembros');
  if (objetivo.rol === 'creador') throw new CasaError('no_se_puede_quitar_creador', 'No se puede quitar a quien creó la casa');

  const movimientos = await leerMovimientos(ctx.ownerId, casaId);
  const { porMoneda } = calcularSaldos(ctx.miembros, movimientos);
  const debe = Object.values(porMoneda).some((m) => m.saldos.some((s) => s.id === objetivo.id && s.saldo !== 0));
  if (debe) throw new CasaError('saldo_pendiente', 'Tiene saldo pendiente: liquidá antes de quitarlo');

  const sheet = await tab(ctx.ownerId, TAB_MIEMBROS);
  await withOwnerWriteLock(ctx.ownerId, async () => {
    const fila = (await sheet.getRows()).find((r) => String(r.get('ID_Casa') || '') === casaId && String(r.get('ID_Miembro') || '') === objetivo.id);
    if (!fila) throw new CasaError('miembro_inexistente', 'No existe ese miembro');
    fila.set('Estado', 'baja');
    await fila.save();
  });

  if (objetivo.userId) {
    const suyas = clienteService.getCasas(objetivo.userId);
    if (suyas) await clienteService.setCasas(objetivo.userId, suyas.filter((c) => c.casaId !== casaId));
  }
  notificarMiembros(ctx.miembros);
  logger.audit('casa_miembro_baja', { userId, casaId, miembroId: objetivo.id, salida: esSalida });
  return true;
}

// ── Movimientos ──────────────────────────────────────────────────────────────

async function leerMovimientos(ownerId, casaId) {
  const rows = await (await tab(ownerId, TAB_MOVIMIENTOS)).getRows();
  return rows.map(rowToMovimiento).filter((m) => m.casaId === casaId);
}

function validarMonto(monto) {
  const n = Math.abs(parseFloat(monto));
  if (!Number.isFinite(n) || n <= 0) throw new CasaError('monto_invalido', 'Monto inválido');
  return n;
}

function validarMoneda(moneda) {
  const m = moneda || 'Pesos';
  if (!MONEDAS.includes(m)) throw new CasaError('moneda_invalida', 'Moneda inválida');
  return m;
}

function idsActivos(ctx) { return activos(ctx.miembros).map((m) => m.id); }

function validarMiembroActivo(ctx, id, campo) {
  if (!activos(ctx.miembros).some((m) => m.id === String(id))) {
    throw new CasaError(`${campo}_invalido`, 'Ese miembro no pertenece a la casa');
  }
  return String(id);
}

/**
 * Registra un gasto compartido. Por defecto paga quien lo carga y se reparte
 * entre todos los miembros activos EN ESTE MOMENTO (los ids se guardan
 * explícitos: quien se una después no hereda gastos viejos).
 */
async function registrarGasto(userId, casaId, datos = {}) {
  const ctx = await obtenerCasaParaMiembro(userId, casaId);

  const monto = validarMonto(datos.monto);
  const moneda = validarMoneda(datos.moneda);
  const descripcion = String(datos.descripcion || '').trim();
  if (descripcion.length < 2) throw new CasaError('descripcion_invalida', 'Descripción inválida');

  const pagoPor = datos.pagoPor ? validarMiembroActivo(ctx, datos.pagoPor, 'pagador') : ctx.yo.id;

  let reparto;
  if (Array.isArray(datos.repartoEntre) && datos.repartoEntre.length > 0) {
    reparto = [...new Set(datos.repartoEntre.map((id) => validarMiembroActivo(ctx, id, 'reparto')))];
  } else {
    reparto = idsActivos(ctx);
  }

  const movimiento = {
    idMov: generarId('cmov'),
    casaId,
    fecha: datos.fecha || fechaArgentinaStr(),
    hora: datos.hora || horaArgentinaStr(),
    tipo: 'gasto',
    descripcion,
    monto,
    moneda,
    montoPesos: convertirAPesos(monto, moneda),
    metodoPago: datos.metodoPago || '',
    categoria: datos.categoria || '',
    pagoPor,
    repartoEntre: reparto,
    para: '',
    notas: datos.notas || '',
    idOrigen: String(userId),
  };

  await escribirMovimiento(ctx.ownerId, movimiento);
  notificarMiembros(ctx.miembros);
  logger.audit('casa_gasto_registrado', { userId, casaId, idMov: movimiento.idMov, moneda, pagoPor });
  return { movimiento, miembros: activos(ctx.miembros) };
}

// Una liquidación: `de` le entregó `monto` a `para` para saldar deuda.
async function registrarLiquidacion(userId, casaId, datos = {}) {
  const ctx = await obtenerCasaParaMiembro(userId, casaId);

  const monto = validarMonto(datos.monto);
  const moneda = validarMoneda(datos.moneda);
  const de = datos.de ? validarMiembroActivo(ctx, datos.de, 'pagador') : ctx.yo.id;
  const para = validarMiembroActivo(ctx, datos.para, 'destinatario');
  if (de === para) throw new CasaError('liquidacion_invalida', 'No se puede liquidar con uno mismo');

  const nombreDe = ctx.miembros.find((m) => m.id === de).nombre;
  const nombrePara = ctx.miembros.find((m) => m.id === para).nombre;
  const movimiento = {
    idMov: generarId('cmov'),
    casaId,
    fecha: datos.fecha || fechaArgentinaStr(),
    hora: datos.hora || horaArgentinaStr(),
    tipo: 'liquidacion',
    descripcion: `${nombreDe} le pagó a ${nombrePara}`,
    monto,
    moneda,
    montoPesos: convertirAPesos(monto, moneda),
    metodoPago: datos.metodoPago || '',
    categoria: '',
    pagoPor: de,
    repartoEntre: [],
    para,
    notas: datos.notas || '',
    idOrigen: String(userId),
  };

  await escribirMovimiento(ctx.ownerId, movimiento);
  notificarMiembros(ctx.miembros);
  logger.audit('casa_liquidacion_registrada', { userId, casaId, idMov: movimiento.idMov, moneda });
  return { movimiento };
}

async function escribirMovimiento(ownerId, m) {
  const sheet = await tab(ownerId, TAB_MOVIMIENTOS);
  await withOwnerWriteLock(ownerId, () => sheet.addRow({
    ID_Mov: m.idMov,
    ID_Casa: m.casaId,
    Fecha: m.fecha,
    Hora: m.hora,
    Tipo: m.tipo,
    Descripcion: m.descripcion,
    Monto: m.monto,
    Moneda: m.moneda,
    MontoPesos: m.montoPesos,
    MetodoPago: m.metodoPago,
    Categoria: m.categoria,
    PagoPor: m.pagoPor,
    RepartoEntre: m.repartoEntre.join(','),
    Para: m.para,
    Notas: m.notas,
    ID_Origen: m.idOrigen,
  }));
}

async function listarMovimientos(userId, casaId, { mes } = {}) {
  const ctx = await obtenerCasaParaMiembro(userId, casaId);
  const todos = await leerMovimientos(ctx.ownerId, casaId);
  const filtrados = mes ? todos.filter((m) => (fechaStrAIso(m.fecha) || '').startsWith(mes)) : todos;
  return filtrados.sort((a, b) => `${fechaStrAIso(b.fecha) || ''} ${b.hora}`.localeCompare(`${fechaStrAIso(a.fecha) || ''} ${a.hora}`));
}

// Puede borrar quien lo cargó o quien creó la casa.
async function eliminarMovimiento(userId, casaId, idMov) {
  const ctx = await obtenerCasaParaMiembro(userId, casaId);
  const sheet = await tab(ctx.ownerId, TAB_MOVIMIENTOS);

  return withOwnerWriteLock(ctx.ownerId, async () => {
    const fila = (await sheet.getRows()).find((r) => String(r.get('ID_Casa') || '') === casaId && String(r.get('ID_Mov') || '') === String(idMov));
    if (!fila) return false;
    if (!ctx.esCreador && String(fila.get('ID_Origen') || '') !== String(userId)) {
      throw new CasaError('sin_permiso', 'Solo quien lo cargó o quien creó la casa puede borrarlo');
    }
    await fila.delete();
    notificarMiembros(ctx.miembros);
    logger.audit('casa_movimiento_eliminado', { userId, casaId, idMov });
    return true;
  });
}

// ── Saldos y resumen ─────────────────────────────────────────────────────────

function conNombres(porMoneda, miembros) {
  const nombre = (id) => (miembros.find((m) => m.id === id) || {}).nombre || id;
  const salida = {};
  for (const [moneda, d] of Object.entries(porMoneda)) {
    salida[moneda] = {
      totalGastado: d.totalGastado,
      // Se ocultan los miembros dados de baja ya en cero.
      saldos: d.saldos
        .filter((s) => s.saldo !== 0 || activos(miembros).some((m) => m.id === s.id))
        .map((s) => ({ ...s, nombre: nombre(s.id) })),
      transferencias: d.transferencias.map((t) => ({ ...t, deNombre: nombre(t.de), paraNombre: nombre(t.para) })),
    };
  }
  return salida;
}

// Saldos de toda la historia de la casa (no dependen del mes).
async function calcularSaldosCasa(userId, casaId) {
  const ctx = await obtenerCasaParaMiembro(userId, casaId);
  const movimientos = await leerMovimientos(ctx.ownerId, casaId);
  const { porMoneda, ignorados } = calcularSaldos(ctx.miembros, movimientos);
  return { casa: ctx.casa, saldos: conNombres(porMoneda, ctx.miembros), ignorados };
}

// Fuente única de los números del bot (/casa) y del dashboard.
async function calcularResumenCasa(userId, casaId, mes = mesActualIso()) {
  const ctx = await obtenerCasaParaMiembro(userId, casaId);
  const todos = await leerMovimientos(ctx.ownerId, casaId);
  const delMes = todos.filter((m) => (fechaStrAIso(m.fecha) || '').startsWith(mes));

  const gastosPorMoneda = {};
  const porCategoria = {};
  for (const m of delMes) {
    if (m.tipo !== 'gasto') continue;
    gastosPorMoneda[m.moneda] = Math.round(((gastosPorMoneda[m.moneda] || 0) + m.monto) * 100) / 100;
    const cat = m.categoria || 'otros';
    porCategoria[cat] = Math.round(((porCategoria[cat] || 0) + m.montoPesos) * 100) / 100;
  }

  const { porMoneda, ignorados } = calcularSaldos(ctx.miembros, todos);
  return {
    casa: ctx.casa,
    mes,
    miembros: activos(ctx.miembros),
    yo: ctx.yo,
    esCreador: ctx.esCreador,
    gastosPorMoneda,
    porCategoria,
    cantidad: delMes.length,
    movimientos: delMes.sort((a, b) => `${fechaStrAIso(b.fecha) || ''} ${b.hora}`.localeCompare(`${fechaStrAIso(a.fecha) || ''} ${a.hora}`)),
    saldos: conNombres(porMoneda, ctx.miembros),
    ignorados,
  };
}

module.exports = {
  CasaError,
  TAB_CASAS,
  TAB_MIEMBROS,
  TAB_MOVIMIENTOS,
  COLS,
  MONEDAS,
  listarMisCasas,
  getCasaActiva,
  setCasaActiva,
  obtenerCasaParaMiembro,
  crearCasa,
  listarMiembros,
  agregarMiembroVirtual,
  unirMiembro,
  quitarMiembro,
  registrarGasto,
  registrarLiquidacion,
  listarMovimientos,
  eliminarMovimiento,
  calcularSaldosCasa,
  calcularResumenCasa,
  mesActualIso,
};
