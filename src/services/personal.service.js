// Almacenamiento del ámbito personal.
//
// Fuente de verdad: pestañas dedicadas en el spreadsheet del usuario (mismo
// patrón que la hoja "Turnos" de la agenda). Cuando USE_SUPABASE=true se hace
// dual-write a tablas propias — NO a movimientos_v2, que tiene un CHECK con las
// categorías del consultorio y rechazaría "supermercado" en silencio.
//
// Las escrituras emiten eventos SSE a mano: los movimientos del consultorio los
// emiten desde db.service, y este camino no pasa por ahí.

const { getDocCliente, invalidateCache } = require('./sheet.service');
const { withUserWriteLock } = require('../lib/write-queue');
const { getSupabase, isAvailable } = require('../lib/supabase');
const { emitMovimientosUpdated } = require('./events.service');
const { convertirAPesos } = require('./movimiento.service');
const logger = require('../lib/logger');

const TAB_MOVIMIENTOS = 'Personal';
const TAB_VIAJES = 'Viajes';
const TAB_PRESUPUESTOS = 'Presupuestos';
const TAB_PREFERENCIAS = 'Preferencias';

const COLS_MOVIMIENTOS = [
  'ID_Mov', 'Fecha', 'Hora', 'Descripcion', 'Monto', 'Tipo', 'Moneda',
  'MontoPesos', 'MetodoPago', 'Categoria', 'Comercio', 'ViajeId', 'Notas',
  'ID_Origen',
];
const COLS_VIAJES = [
  'ID_Viaje', 'Nombre', 'FechaInicio', 'FechaFin', 'Estado', 'Presupuesto',
  'Moneda', 'Notas',
];
const COLS_PRESUPUESTOS = ['Categoria', 'MontoMensual', 'Moneda', 'Activo'];
const COLS_PREFERENCIAS = ['Termino', 'Ambito', 'Actualizado'];

const TABS = {
  [TAB_MOVIMIENTOS]: COLS_MOVIMIENTOS,
  [TAB_VIAJES]: COLS_VIAJES,
  [TAB_PRESUPUESTOS]: COLS_PRESUPUESTOS,
  [TAB_PREFERENCIAS]: COLS_PREFERENCIAS,
};

// Categorías que nunca se atribuyen a un viaje: son gastos recurrentes de la
// vida normal que siguen corriendo mientras estás de viaje. Sin esto, la luz
// pagada durante el viaje ensuciaría el total del viaje.
const CATEGORIAS_FUERA_DE_VIAJE = new Set([
  'alquiler', 'servicios', 'expensas', 'impuestos', 'salud', 'educacion',
  'mascotas',
]);

// ── Acceso a las pestañas ────────────────────────────────────────────────────

// Espeja crearTabTurnosSiNoExiste (agenda.service.js): el getter headerValues
// TIRA si el header no está cargado, así que hay que probarlo dentro del try, y
// una tab que quedó a medio crear se rearma en vez de fallar.
async function getTab(userId, title, fresh = false) {
  const doc = await getDocCliente(userId, fresh);
  if (!doc) return null;

  const cols = TABS[title];
  if (!cols) throw new Error(`Tab personal desconocida: ${title}`);

  try {
    let sheet = doc.sheetsByTitle[title];
    if (sheet) {
      let headerValues = null;
      try {
        await sheet.loadHeaderRow();
        headerValues = sheet.headerValues;
      } catch (_) {
        headerValues = null;
      }
      if (!Array.isArray(headerValues) || headerValues.length === 0) {
        await sheet.setHeaderRow(cols);
        await sheet.loadHeaderRow();
      }
      return sheet;
    }

    console.log(`Creando tab ${title}...`);
    sheet = await doc.addSheet({ title });
    await sheet.setHeaderRow(cols);
    await sheet.loadHeaderRow();
    console.log(`Tab ${title} creada OK`);
    return sheet;
  } catch (err) {
    console.error(`Error al crear tab ${title}:`, err.message);
    throw new Error(`No se pudo acceder a la tab ${title}: ${err.message}`);
  }
}

// Si el doc no estaba cacheado con la tab recién creada, un segundo intento con
// fresh=true la encuentra. Evita el caso de "creé la tab pero no la veo".
async function getTabConReintento(userId, title) {
  const sheet = await getTab(userId, title);
  if (sheet) return sheet;
  return getTab(userId, title, true);
}

// ── Capacidades de Supabase (espeja resolveV2Capabilities) ───────────────────

const capCache = { checked: false, movimientos: false, viajes: false, presupuestos: false };
let capPromise = null;
let missingTablesLogged = false;

function isMissingRelationError(error) {
  return Boolean(error && /relation .* does not exist|could not find the table/i.test(error.message || ''));
}

async function resolvePersonalCapabilities() {
  if (!isAvailable()) {
    return { movimientos: false, viajes: false, presupuestos: false };
  }
  if (capCache.checked) {
    return { movimientos: capCache.movimientos, viajes: capCache.viajes, presupuestos: capCache.presupuestos };
  }
  if (capPromise) return capPromise;

  capPromise = (async () => {
    const supabase = getSupabase();
    const result = { movimientos: false, viajes: false, presupuestos: false };

    for (const [key, tabla] of [
      ['movimientos', 'movimientos_personales'],
      ['viajes', 'viajes_personales'],
      ['presupuestos', 'presupuestos_personales'],
    ]) {
      const check = await supabase.from(tabla).select('id').limit(1);
      if (!check.error) {
        result[key] = true;
      } else if (!isMissingRelationError(check.error)) {
        console.error(`Supabase ${tabla} check error:`, check.error.message);
      }
    }

    if (!result.movimientos && !missingTablesLogged) {
      missingTablesLogged = true;
      console.log('Supabase personal no disponible todavia. Continuo solo con Sheets.');
    }

    Object.assign(capCache, { checked: true, ...result });
    capPromise = null;
    return result;
  })();

  return capPromise;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generarIdMov() {
  return `pers_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

function generarIdViaje() {
  return `viaje_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

function fechaHoyStr() {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

function horaAhoraStr() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

// Las fechas del Sheet son DD/MM/YYYY; para comparar rangos hace falta ISO.
function fechaStrAIso(fecha) {
  const raw = String(fecha || '').trim();
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function esEgreso(tipo) {
  return ['gasto', 'egreso'].includes(String(tipo || '').toLowerCase());
}

// ── Preferencias de ámbito (memoria de correcciones) ─────────────────────────

async function leerPreferencias(userId) {
  try {
    const sheet = await getTabConReintento(userId, TAB_PREFERENCIAS);
    if (!sheet) return {};
    const rows = await sheet.getRows();
    const prefs = {};
    for (const row of rows) {
      const termino = String(row.get('Termino') || '').trim().toLowerCase();
      const ambito = String(row.get('Ambito') || '').trim().toLowerCase();
      if (termino && (ambito === 'personal' || ambito === 'consultorio')) {
        prefs[termino] = ambito;
      }
    }
    return prefs;
  } catch (error) {
    // Nunca romper la carga de un movimiento por no poder leer preferencias.
    console.error('No se pudieron leer las preferencias de ámbito:', error.message);
    return {};
  }
}

async function guardarPreferencia(userId, termino, ambito) {
  const key = String(termino || '').trim().toLowerCase();
  if (!key || !['personal', 'consultorio'].includes(ambito)) return false;

  try {
    const sheet = await getTabConReintento(userId, TAB_PREFERENCIAS);
    if (!sheet) return false;

    await withUserWriteLock(userId, async () => {
      const rows = await sheet.getRows();
      const existente = rows.find(r => String(r.get('Termino') || '').trim().toLowerCase() === key);
      if (existente) {
        existente.set('Ambito', ambito);
        existente.set('Actualizado', new Date().toISOString());
        await existente.save();
        return;
      }
      await sheet.addRow({ Termino: key, Ambito: ambito, Actualizado: new Date().toISOString() });
    });

    logger.audit('personal_preferencia_guardada', { userId, termino: key, ambito });
    return true;
  } catch (error) {
    console.error('No se pudo guardar la preferencia de ámbito:', error.message);
    return false;
  }
}

// ── Viajes ───────────────────────────────────────────────────────────────────

async function obtenerViajeActivo(userId) {
  try {
    const sheet = await getTabConReintento(userId, TAB_VIAJES);
    if (!sheet) return null;
    const rows = await sheet.getRows();
    const activos = rows.filter(r => String(r.get('Estado') || '').trim().toLowerCase() === 'activo');
    if (activos.length === 0) return null;

    const row = activos[activos.length - 1];
    return {
      idViaje: row.get('ID_Viaje'),
      nombre: row.get('Nombre'),
      fechaInicio: row.get('FechaInicio'),
      fechaFin: row.get('FechaFin'),
      presupuesto: parseFloat(row.get('Presupuesto')) || null,
      moneda: row.get('Moneda') || 'Pesos',
      _row: row,
    };
  } catch (error) {
    console.error('No se pudo leer el viaje activo:', error.message);
    return null;
  }
}

async function crearViaje(userId, { nombre, fechaInicio, fechaFin, presupuesto = null, moneda = 'Pesos' }) {
  const sheet = await getTabConReintento(userId, TAB_VIAJES);
  if (!sheet) throw new Error('sin_sheet');

  const idViaje = generarIdViaje();
  await withUserWriteLock(userId, () => sheet.addRow({
    ID_Viaje: idViaje,
    Nombre: nombre,
    FechaInicio: fechaInicio || '',
    FechaFin: fechaFin || '',
    Estado: 'activo',
    Presupuesto: presupuesto ?? '',
    Moneda: moneda,
    Notas: '',
  }));

  logger.audit('personal_viaje_creado', { userId, idViaje, nombre });
  return { idViaje, nombre, fechaInicio, fechaFin, presupuesto, moneda };
}

async function cerrarViaje(userId) {
  const viaje = await obtenerViajeActivo(userId);
  if (!viaje) return null;

  await withUserWriteLock(userId, async () => {
    viaje._row.set('Estado', 'cerrado');
    await viaje._row.save();
  });

  logger.audit('personal_viaje_cerrado', { userId, idViaje: viaje.idViaje });
  return viaje;
}

/**
 * Decide si un gasto se atribuye al viaje activo.
 * Requiere que la fecha caiga en el rango Y que la categoría no sea de las
 * recurrentes/domésticas — así la luz pagada durante el viaje no lo ensucia.
 */
function correspondeAlViaje(viaje, { fecha, categoria }) {
  if (!viaje) return false;
  if (CATEGORIAS_FUERA_DE_VIAJE.has(categoria)) return false;

  const iso = fechaStrAIso(fecha);
  const desde = fechaStrAIso(viaje.fechaInicio);
  const hasta = fechaStrAIso(viaje.fechaFin);
  if (!iso) return false;
  if (desde && iso < desde) return false;
  if (hasta && iso > hasta) return false;
  return true;
}

// ── Presupuestos ─────────────────────────────────────────────────────────────

async function obtenerPresupuestos(userId) {
  try {
    const sheet = await getTabConReintento(userId, TAB_PRESUPUESTOS);
    if (!sheet) return [];
    const rows = await sheet.getRows();
    return rows
      .filter(r => String(r.get('Activo') || 'si').trim().toLowerCase() !== 'no')
      .map(r => ({
        categoria: String(r.get('Categoria') || '').trim().toLowerCase(),
        montoMensual: parseFloat(r.get('MontoMensual')) || 0,
        moneda: r.get('Moneda') || 'Pesos',
      }))
      .filter(p => p.categoria && p.montoMensual > 0);
  } catch (error) {
    console.error('No se pudieron leer los presupuestos:', error.message);
    return [];
  }
}

/**
 * Evalúa el presupuesto de una categoría para el mes de `fecha`.
 * Devuelve null si no hay presupuesto definido para esa categoría.
 */
async function evaluarPresupuesto(userId, categoria, fecha = fechaHoyStr()) {
  const presupuestos = await obtenerPresupuestos(userId);
  const presupuesto = presupuestos.find(p => p.categoria === categoria);
  if (!presupuesto) return null;

  const iso = fechaStrAIso(fecha);
  const mes = iso ? iso.substring(0, 7) : null;
  if (!mes) return null;

  const movimientos = await obtenerMovimientosPersonales(userId);
  // Reusa el mismo cálculo que el resumen para no tener dos definiciones de
  // "cuánto gasté" que puedan divergir.
  return evaluarPresupuestosDesde(movimientos, [presupuesto], mes)[0] || null;
}

// ── Movimientos ──────────────────────────────────────────────────────────────

function rowToMovimientoPersonal(row) {
  return {
    idMov: row.get('ID_Mov') || null,
    fecha: row.get('Fecha') || null,
    hora: row.get('Hora') || null,
    descripcion: row.get('Descripcion') || '',
    monto: parseFloat(row.get('Monto')) || 0,
    tipo: row.get('Tipo') || 'Egreso',
    moneda: row.get('Moneda') || 'Pesos',
    montoPesos: parseFloat(row.get('MontoPesos')) || 0,
    metodoPago: row.get('MetodoPago') || null,
    categoria: String(row.get('Categoria') || '').trim().toLowerCase() || null,
    comercio: row.get('Comercio') || null,
    viajeId: row.get('ViajeId') || null,
    notas: row.get('Notas') || null,
  };
}

async function obtenerMovimientosPersonales(userId) {
  try {
    const sheet = await getTabConReintento(userId, TAB_MOVIMIENTOS);
    if (!sheet) return [];
    const rows = await sheet.getRows();
    return rows.map(rowToMovimientoPersonal).filter(m => m.descripcion || m.monto);
  } catch (error) {
    console.error('No se pudieron leer los movimientos personales:', error.message);
    return [];
  }
}

async function insertarEnSupabase(userId, movimiento) {
  const caps = await resolvePersonalCapabilities();
  if (!caps.movimientos) return null;

  const supabase = getSupabase();
  const payload = {
    user_id: userId,
    legacy_id: movimiento.idMov,
    tipo_movimiento: esEgreso(movimiento.tipo) ? 'egreso' : 'ingreso',
    categoria: movimiento.categoria,
    descripcion: movimiento.descripcion,
    comercio: movimiento.comercio,
    monto_original: Math.abs(movimiento.monto),
    monto_pesos: Math.abs(movimiento.montoPesos),
    moneda: movimiento.moneda,
    metodo_pago: movimiento.metodoPago,
    fecha: fechaStrAIso(movimiento.fecha),
    viaje_id: movimiento.viajeId || null,
    notas: movimiento.notas || null,
    origen_carga: movimiento.origenCarga || 'bot',
  };

  const { data, error } = await supabase
    .from('movimientos_personales')
    .insert(payload)
    .select('id')
    .single();

  if (error) {
    // El Sheet ya guardó: no se le corta la operación al usuario por esto.
    console.error('Supabase movimientos_personales insert error:', error.message);
    return null;
  }
  return data;
}

/**
 * Registra un movimiento personal. El Sheet es la fuente de verdad; Supabase es
 * dual-write best-effort. Emite el evento SSE para que el dashboard se refresque.
 */
async function registrarMovimientoPersonal(userId, datos) {
  const {
    descripcion,
    monto,
    tipo = 'gasto',
    moneda = 'Pesos',
    metodoPago = null,
    categoria,
    comercio = null,
    notas = null,
    origenCarga = 'bot',
  } = datos;

  const montoAbs = Math.abs(parseFloat(monto));
  if (!Number.isFinite(montoAbs) || montoAbs <= 0) {
    throw new Error('monto_invalido');
  }
  if (!descripcion || String(descripcion).trim().length < 2) {
    throw new Error('descripcion_invalida');
  }

  const sheet = await getTabConReintento(userId, TAB_MOVIMIENTOS);
  if (!sheet) throw new Error('sin_sheet');

  const fecha = datos.fecha || fechaHoyStr();

  // Si el llamador ya decidió el viaje (ej. el usuario tocó "No es del viaje"
  // en la confirmación), se respeta su decisión — incluso si es null. Solo se
  // autoatribuye cuando no viene la clave.
  const viajeActivo = await obtenerViajeActivo(userId);
  const viajeDecidido = Object.prototype.hasOwnProperty.call(datos, 'viajeId');
  const viajeId = viajeDecidido
    ? (datos.viajeId || null)
    : (correspondeAlViaje(viajeActivo, { fecha, categoria }) ? viajeActivo.idViaje : null);

  const movimiento = {
    idMov: generarIdMov(),
    fecha,
    hora: datos.hora || horaAhoraStr(),
    descripcion: String(descripcion).trim(),
    monto: montoAbs,
    tipo: esEgreso(tipo) ? 'Egreso' : 'Ingreso',
    moneda,
    montoPesos: convertirAPesos(montoAbs, moneda),
    metodoPago,
    categoria,
    comercio,
    viajeId,
    notas,
    origenCarga,
  };

  await withUserWriteLock(userId, () => sheet.addRow({
    ID_Mov: movimiento.idMov,
    Fecha: movimiento.fecha,
    Hora: movimiento.hora,
    Descripcion: movimiento.descripcion,
    Monto: movimiento.monto,
    Tipo: movimiento.tipo,
    Moneda: movimiento.moneda,
    MontoPesos: movimiento.montoPesos,
    MetodoPago: movimiento.metodoPago || '',
    Categoria: movimiento.categoria || '',
    Comercio: movimiento.comercio || '',
    ViajeId: movimiento.viajeId || '',
    Notas: movimiento.notas || '',
    ID_Origen: String(userId),
  }));

  invalidateCache(userId);
  await insertarEnSupabase(userId, movimiento);

  // Este camino no pasa por db.service, que es quien normalmente emite el
  // evento — si no se llama acá, el dashboard no se actualiza solo.
  emitMovimientosUpdated(userId);
  logger.audit('personal_movimiento_registrado', {
    userId,
    idMov: movimiento.idMov,
    categoria: movimiento.categoria,
    viajeId: movimiento.viajeId,
  });

  return { movimiento, viaje: viajeId ? viajeActivo : null };
}

async function eliminarMovimientoPersonal(userId, idMov) {
  const sheet = await getTabConReintento(userId, TAB_MOVIMIENTOS);
  if (!sheet) throw new Error('sin_sheet');

  const rows = await sheet.getRows();
  const fila = rows.find(r => String(r.get('ID_Mov') || '') === String(idMov));
  if (!fila) return false;

  await withUserWriteLock(userId, () => fila.delete());
  invalidateCache(userId);

  const caps = await resolvePersonalCapabilities();
  if (caps.movimientos) {
    const { error } = await getSupabase()
      .from('movimientos_personales')
      .delete()
      .eq('legacy_id', String(idMov));
    if (error) console.error('Supabase movimientos_personales delete error:', error.message);
  }

  emitMovimientosUpdated(userId);
  logger.audit('personal_movimiento_eliminado', { userId, idMov });
  return true;
}

async function guardarPresupuesto(userId, categoria, montoMensual, moneda = 'Pesos') {
  const cat = String(categoria || '').trim().toLowerCase();
  const monto = parseFloat(montoMensual);
  if (!cat) throw new Error('categoria_invalida');
  if (!Number.isFinite(monto) || monto < 0) throw new Error('monto_invalido');

  const sheet = await getTabConReintento(userId, TAB_PRESUPUESTOS);
  if (!sheet) throw new Error('sin_sheet');

  await withUserWriteLock(userId, async () => {
    const rows = await sheet.getRows();
    const existente = rows.find(r => String(r.get('Categoria') || '').trim().toLowerCase() === cat);

    // Monto 0 = desactivar el presupuesto, sin borrar la fila.
    if (existente) {
      existente.set('MontoMensual', monto);
      existente.set('Moneda', moneda);
      existente.set('Activo', monto > 0 ? 'si' : 'no');
      await existente.save();
      return;
    }
    if (monto > 0) {
      await sheet.addRow({ Categoria: cat, MontoMensual: monto, Moneda: moneda, Activo: 'si' });
    }
  });

  logger.audit('personal_presupuesto_guardado', { userId, categoria: cat, monto });
  return { categoria: cat, montoMensual: monto, moneda, activo: monto > 0 };
}

function mesActualIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function montoEnPesos(movimiento) {
  return Math.abs(Number(movimiento.montoPesos) || Number(movimiento.monto) || 0);
}

/**
 * Evalúa los presupuestos a partir de movimientos ya cargados.
 * Puro y sin I/O — evita una lectura del Sheet por categoría (N+1) cuando se
 * arma el resumen completo.
 */
function evaluarPresupuestosDesde(movimientos, presupuestos, mes) {
  const gastoPorCategoria = new Map();
  for (const m of movimientos) {
    if (!esEgreso(m.tipo)) continue;
    if (!(fechaStrAIso(m.fecha) || '').startsWith(mes)) continue;
    const cat = m.categoria || 'otros';
    gastoPorCategoria.set(cat, (gastoPorCategoria.get(cat) || 0) + montoEnPesos(m));
  }

  return presupuestos.map(p => {
    const gastado = gastoPorCategoria.get(p.categoria) || 0;
    const porcentaje = p.montoMensual > 0 ? Math.round((gastado / p.montoMensual) * 100) : 0;
    return {
      categoria: p.categoria,
      limite: p.montoMensual,
      gastado,
      restante: Math.max(p.montoMensual - gastado, 0),
      porcentaje,
      moneda: p.moneda,
      excedido: gastado > p.montoMensual,
      enAlerta: porcentaje >= 80,
    };
  });
}

/**
 * Resumen del ámbito personal para un mes (default: el actual).
 * Fuente única de los números que muestran el bot (/personal) y el dashboard,
 * para que no se puedan desincronizar.
 */
async function calcularResumenPersonal(userId, mes = mesActualIso()) {
  const [movimientos, presupuestos, viaje] = await Promise.all([
    obtenerMovimientosPersonales(userId),
    obtenerPresupuestos(userId),
    obtenerViajeActivo(userId),
  ]);

  const delMes = movimientos.filter(m => (fechaStrAIso(m.fecha) || '').startsWith(mes));

  let ingresos = 0;
  let egresos = 0;
  const acumCategoria = new Map();

  for (const m of delMes) {
    const monto = montoEnPesos(m);
    if (esEgreso(m.tipo)) {
      egresos += monto;
      const cat = m.categoria || 'otros';
      acumCategoria.set(cat, (acumCategoria.get(cat) || 0) + monto);
    } else {
      ingresos += monto;
    }
  }

  const porCategoria = [...acumCategoria.entries()]
    .map(([categoria, total]) => ({
      categoria,
      total,
      porcentaje: egresos > 0 ? Math.round((total / egresos) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  let viajeResumen = null;
  if (viaje) {
    const delViaje = movimientos.filter(m => m.viajeId === viaje.idViaje);
    viajeResumen = {
      idViaje: viaje.idViaje,
      nombre: viaje.nombre,
      fechaInicio: viaje.fechaInicio,
      fechaFin: viaje.fechaFin,
      presupuesto: viaje.presupuesto,
      moneda: viaje.moneda,
      total: delViaje.filter(esEgresoMov).reduce((acc, m) => acc + montoEnPesos(m), 0),
      cantidad: delViaje.length,
    };
  }

  return {
    mes,
    ingresos,
    egresos,
    balance: ingresos - egresos,
    cantidad: delMes.length,
    porCategoria,
    presupuestos: evaluarPresupuestosDesde(movimientos, presupuestos, mes),
    viaje: viajeResumen,
    movimientos: delMes,
  };
}

function esEgresoMov(m) {
  return esEgreso(m.tipo);
}

module.exports = {
  registrarMovimientoPersonal,
  obtenerMovimientosPersonales,
  eliminarMovimientoPersonal,
  guardarPresupuesto,
  calcularResumenPersonal,
  evaluarPresupuestosDesde,
  mesActualIso,
  leerPreferencias,
  guardarPreferencia,
  obtenerViajeActivo,
  crearViaje,
  cerrarViaje,
  correspondeAlViaje,
  fechaHoyStr,
  obtenerPresupuestos,
  evaluarPresupuesto,
  resolvePersonalCapabilities,
  fechaStrAIso,
  CATEGORIAS_FUERA_DE_VIAJE,
  TAB_MOVIMIENTOS,
  TAB_VIAJES,
  TAB_PRESUPUESTOS,
  TAB_PREFERENCIAS,
  TABS,
};
