// Repositorio de Personal sobre Supabase, POR PERSONA.
//
// Misma interfaz y MISMAS formas de datos que devuelve el camino del Sheet
// (personal.service.js), así el resto del bot, la API y el dashboard no se enteran
// de dónde viene cada cosa. Reglas:
//
//   - Toda consulta pasa por forPersona(tenantId, userId): aislamiento por persona
//     dentro del tenant (ver lib/persona-db.js).
//   - Los errores de Supabase SE PROPAGAN (PersonalRepoError): antes se tragaban con
//     console.error y el usuario creía que se había guardado.
//   - No hay espejo al Sheet: lo personal de un agregado nunca debe escribirse en el
//     sheet del dueño.

const { forPersona } = require('../lib/persona-db');
const { resolveTenantId } = require('./tenant.service');
const { fechaStrAIso } = require('../utils/date');

const PAGINA = 1000;
const METODOS = ['efectivo', 'transferencia', 'tarjeta', 'debito', 'otro'];
const ORIGENES = ['bot', 'web', 'sheet', 'migracion', 'dashboard', 'comprobante'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class PersonalRepoError extends Error {
  constructor(code, detalle) {
    super(detalle ? `${code}: ${detalle}` : code);
    this.name = 'PersonalRepoError';
    this.code = code;
  }
}

// ensureProfile crea el perfil (la FK user_id -> profiles lo exige) y es una
// ida y vuelta a la base: una vez por persona y por proceso alcanza.
const perfilesAsegurados = new Set();

async function db(userId) {
  const clave = String(userId);
  if (!perfilesAsegurados.has(clave)) {
    const { ensureProfile } = require('./db.service'); // lazy: evita un ciclo de imports
    await ensureProfile(userId);
    perfilesAsegurados.add(clave);
  }
  const tenantId = await resolveTenantId(userId);
  if (!tenantId) throw new PersonalRepoError('personal_sin_tenant');
  const persona = forPersona(tenantId, userId);
  if (!persona) throw new PersonalRepoError('personal_sin_supabase');
  return persona;
}

function datos(respuesta, contexto) {
  if (respuesta && respuesta.error) {
    throw new PersonalRepoError('personal_db_error', `${contexto}: ${respuesta.error.message}`);
  }
  return respuesta ? respuesta.data : null;
}

// ── Fechas: la base usa DATE (YYYY-MM-DD); el resto del bot, DD/MM/YYYY ───────

function isoADdmm(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

// ── Conversión fila <-> movimiento ───────────────────────────────────────────

function rowToMovimiento(r) {
  return {
    idMov: r.legacy_id || r.id,
    fecha: isoADdmm(r.fecha),
    hora: r.hora || null,
    descripcion: r.descripcion || '',
    monto: Number(r.monto_original) || 0,
    tipo: r.tipo_movimiento === 'ingreso' ? 'Ingreso' : 'Egreso',
    moneda: r.moneda || 'Pesos',
    montoPesos: Number(r.monto_pesos) || 0,
    metodoPago: r.metodo_pago || null,
    categoria: r.categoria || null,
    comercio: r.comercio || null,
    viajeId: r.viaje_id || null,
    notas: r.notas || null,
  };
}

function normalizarMetodo(metodo) {
  if (!metodo) return null;
  const m = String(metodo).trim().toLowerCase();
  return METODOS.includes(m) ? m : 'otro';
}

function movimientoToRow(m, { createdBy = null } = {}) {
  const fila = {
    legacy_id: m.idMov,
    tipo_movimiento: String(m.tipo).toLowerCase() === 'ingreso' ? 'ingreso' : 'egreso',
    categoria: m.categoria,
    descripcion: m.descripcion || '',
    comercio: m.comercio || null,
    monto_original: m.monto,
    monto_pesos: m.montoPesos,
    moneda: m.moneda || 'Pesos',
    metodo_pago: normalizarMetodo(m.metodoPago),
    fecha: fechaStrAIso(m.fecha) || undefined, // sin fecha válida: rige el DEFAULT de la base
    hora: m.hora || null,
    viaje_id: m.viajeId || null,
    notas: m.notas || null,
    origen_carga: ORIGENES.includes(m.origenCarga) ? m.origenCarga : 'bot',
    created_by: createdBy,
  };
  for (const k of Object.keys(fila)) if (fila[k] === undefined) delete fila[k];
  return fila;
}

// ── Movimientos ──────────────────────────────────────────────────────────────

async function listarMovimientos(userId) {
  const p = await db(userId);
  const salida = [];
  // Supabase corta en 1000 filas por consulta: se pagina para no perder historial.
  for (let desde = 0; ; desde += PAGINA) {
    const filas = datos(
      await p.from('movimientos_personales').select('*').order('fecha', { ascending: false }).range(desde, desde + PAGINA - 1),
      'listar movimientos'
    ) || [];
    salida.push(...filas.map(rowToMovimiento));
    if (filas.length < PAGINA) break;
  }
  return salida;
}

async function insertarMovimiento(userId, movimiento, { createdBy } = {}) {
  const p = await db(userId);
  datos(await p.from('movimientos_personales').insert(movimientoToRow(movimiento, { createdBy: createdBy ?? userId })), 'insertar movimiento');
}

async function obtenerMovimiento(userId, idMov) {
  const p = await db(userId);
  const campo = UUID_RE.test(String(idMov)) ? 'id' : 'legacy_id';
  const filas = datos(
    await p.from('movimientos_personales').select('*').eq(campo, String(idMov)).limit(1),
    'obtener movimiento'
  ) || [];
  return filas.length ? rowToMovimiento(filas[0]) : null;
}

// Solo estos campos se pueden cambiar; el dueño (user_id), el tenant y el id los fija
// forPersona y nunca vienen del llamador. Devuelve false si no existe (o es de otra persona).
async function actualizarMovimiento(userId, idMov, cambios = {}) {
  const p = await db(userId);
  const campo = UUID_RE.test(String(idMov)) ? 'id' : 'legacy_id';
  const patch = {};
  if ('descripcion' in cambios) patch.descripcion = cambios.descripcion;
  if ('monto' in cambios) patch.monto_original = cambios.monto;
  if ('montoPesos' in cambios) patch.monto_pesos = cambios.montoPesos;
  if ('moneda' in cambios) patch.moneda = cambios.moneda;
  if ('categoria' in cambios) patch.categoria = cambios.categoria;
  if ('metodoPago' in cambios) patch.metodo_pago = normalizarMetodo(cambios.metodoPago);
  if ('comercio' in cambios) patch.comercio = cambios.comercio || null;
  if ('notas' in cambios) patch.notas = cambios.notas || null;
  if ('fecha' in cambios) {
    const iso = fechaStrAIso(cambios.fecha);
    if (iso) patch.fecha = iso;
  }
  if (Object.keys(patch).length === 0) return (await obtenerMovimiento(userId, idMov)) !== null;

  const filas = datos(
    await p.from('movimientos_personales').update(patch).eq(campo, String(idMov)).select('id'),
    'actualizar movimiento'
  );
  return Array.isArray(filas) && filas.length > 0;
}

async function eliminarMovimiento(userId, idMov) {
  const p = await db(userId);
  const campo = UUID_RE.test(String(idMov)) ? 'id' : 'legacy_id';
  const borradas = datos(
    await p.from('movimientos_personales').delete().eq(campo, String(idMov)).select('id'),
    'eliminar movimiento'
  );
  return Array.isArray(borradas) && borradas.length > 0;
}

// ── Viajes ───────────────────────────────────────────────────────────────────

function rowToViaje(r) {
  return {
    idViaje: r.legacy_id || r.id,
    nombre: r.nombre,
    fechaInicio: isoADdmm(r.fecha_inicio) || '',
    fechaFin: isoADdmm(r.fecha_fin) || '',
    presupuesto: r.presupuesto == null ? null : (Number(r.presupuesto) || null),
    moneda: r.moneda || 'Pesos',
  };
}

async function obtenerViajeActivo(userId) {
  const p = await db(userId);
  const filas = datos(
    await p.from('viajes_personales').select('*').eq('estado', 'activo').order('created_at', { ascending: false }).limit(1),
    'viaje activo'
  ) || [];
  return filas.length ? rowToViaje(filas[0]) : null;
}

// Todos los viajes de la persona (activos y cerrados): lo usa la importación para no
// duplicar. No se usa en el flujo normal.
async function listarViajes(userId) {
  const p = await db(userId);
  const filas = datos(await p.from('viajes_personales').select('*'), 'listar viajes') || [];
  return filas.map(r => ({ ...rowToViaje(r), estado: r.estado }));
}

async function crearViaje(userId, { idViaje, nombre, fechaInicio, fechaFin, presupuesto = null, moneda = 'Pesos' }, { createdBy, estado = 'activo' } = {}) {
  const p = await db(userId);
  const respuesta = await p.from('viajes_personales').insert({
    legacy_id: idViaje,
    nombre,
    fecha_inicio: fechaStrAIso(fechaInicio),
    fecha_fin: fechaStrAIso(fechaFin),
    estado, // 'activo' en el uso normal; la importación también trae viajes ya cerrados
    presupuesto: presupuesto ?? null,
    moneda,
    created_by: createdBy ?? userId,
  });
  // Índice único: un solo viaje activo por persona.
  if (respuesta && respuesta.error && respuesta.error.code === '23505') throw new PersonalRepoError('viaje_activo_existente');
  datos(respuesta, 'crear viaje');
  return { idViaje, nombre, fechaInicio, fechaFin, presupuesto, moneda };
}

async function cerrarViaje(userId) {
  const viaje = await obtenerViajeActivo(userId);
  if (!viaje) return null;
  const p = await db(userId);
  datos(await p.from('viajes_personales').update({ estado: 'cerrado' }).eq('estado', 'activo'), 'cerrar viaje');
  return viaje;
}

// ── Presupuestos ─────────────────────────────────────────────────────────────

async function listarPresupuestos(userId) {
  const p = await db(userId);
  const filas = datos(await p.from('presupuestos_personales').select('*').eq('activo', true), 'presupuestos') || [];
  return filas
    .map(r => ({ categoria: String(r.categoria || '').toLowerCase(), montoMensual: Number(r.monto_mensual) || 0, moneda: r.moneda || 'Pesos' }))
    .filter(x => x.categoria && x.montoMensual > 0);
}

// Monto 0 = desactivar sin borrar (la tabla exige monto > 0).
async function guardarPresupuesto(userId, categoria, montoMensual, moneda = 'Pesos', { createdBy } = {}) {
  const p = await db(userId);
  if (montoMensual > 0) {
    datos(
      await p.from('presupuestos_personales').upsert(
        { categoria, monto_mensual: montoMensual, moneda, activo: true, created_by: createdBy ?? userId },
        { onConflict: 'user_id,categoria' }
      ),
      'guardar presupuesto'
    );
  } else {
    datos(await p.from('presupuestos_personales').update({ activo: false }).eq('categoria', categoria), 'desactivar presupuesto');
  }
}

// ── Preferencias de ámbito ───────────────────────────────────────────────────

async function leerPreferencias(userId) {
  const p = await db(userId);
  const filas = datos(await p.from('preferencias_ambito_personales').select('termino, ambito'), 'preferencias') || [];
  const prefs = {};
  for (const f of filas) {
    const termino = String(f.termino || '').trim().toLowerCase();
    const ambito = String(f.ambito || '').trim().toLowerCase();
    if (termino && ambito) prefs[termino] = ambito;
  }
  return prefs;
}

async function guardarPreferencia(userId, termino, ambito) {
  const p = await db(userId);
  datos(
    await p.from('preferencias_ambito_personales').upsert({ termino, ambito }, { onConflict: 'user_id,termino' }),
    'guardar preferencia'
  );
}

function _reiniciarCache() { perfilesAsegurados.clear(); }

module.exports = {
  PersonalRepoError,
  listarMovimientos,
  insertarMovimiento,
  obtenerMovimiento,
  actualizarMovimiento,
  eliminarMovimiento,
  obtenerViajeActivo,
  listarViajes,
  crearViaje,
  cerrarViaje,
  listarPresupuestos,
  guardarPresupuesto,
  leerPreferencias,
  guardarPreferencia,
  // para tests y para el script de importación
  rowToMovimiento,
  movimientoToRow,
  rowToViaje,
  isoADdmm,
  _reiniciarCache,
};
