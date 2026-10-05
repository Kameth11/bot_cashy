// Importación del Personal que hoy vive en el Sheet (pestañas Personal / Viajes /
// Presupuestos / Preferencias) a las tablas por persona de Supabase.
//
// Parte PURA y testeable: mapea filas del Sheet a lo que aceptan las tablas (con sus
// CHECK) y decide qué importar. La lectura real del Sheet y el comando viven en
// scripts/importar-personal-a-supabase.js. Es IDEMPOTENTE: correrlo dos veces no
// duplica (se compara por id de movimiento / de viaje, y presupuestos y preferencias
// son upsert).

const crypto = require('crypto');
const { fechaStrAIso } = require('../utils/date');
const {
  normalizarCategoriaPersonal,
  CATEGORIAS_EGRESO_PERSONAL,
  CATEGORIAS_INGRESO_PERSONAL,
} = require('./personal-nlp.service');

const MONEDAS = ['Pesos', 'Dólares', 'Euros'];

// Filas del Sheet sin ID (cargadas a mano): un id determinístico, así reimportar no duplica.
function idSintetico(prefijo, userId, partes) {
  const hash = crypto.createHash('sha1').update([userId, ...partes].map(x => String(x ?? '')).join('|')).digest('hex');
  return `${prefijo}_${hash.slice(0, 16)}`;
}

function normalizarMoneda(valor) {
  const v = String(valor || '').trim();
  if (MONEDAS.includes(v)) return v;
  if (/^d[oó]lar/i.test(v) || /^usd$/i.test(v)) return 'Dólares';
  if (/^euro/i.test(v) || /^eur$/i.test(v)) return 'Euros';
  return 'Pesos';
}

/**
 * @returns {{ok:true, movimiento:object, aviso?:string} | {ok:false, motivo:string}}
 */
function mapearMovimiento(m, userId) {
  const monto = Math.abs(Number(m && m.monto));
  if (!Number.isFinite(monto) || monto <= 0) return { ok: false, motivo: 'monto_invalido' };

  const fecha = fechaStrAIso(m.fecha);
  // Sin fecha legible NO se importa con "hoy": movería un gasto viejo al mes actual.
  if (!fecha) return { ok: false, motivo: 'fecha_ilegible' };

  const tipo = /ingreso/i.test(String(m.tipo || '')) ? 'Ingreso' : 'Egreso';
  const validas = tipo === 'Ingreso' ? CATEGORIAS_INGRESO_PERSONAL : CATEGORIAS_EGRESO_PERSONAL;
  let categoria = normalizarCategoriaPersonal(m.categoria);
  let aviso;
  if (!categoria || !validas.includes(categoria)) {
    // La base tiene un CHECK cerrado: lo que no calce va a la categoría "otros".
    aviso = `categoria_ajustada:${m.categoria || 'vacía'}`;
    categoria = tipo === 'Ingreso' ? 'otro_ingreso' : 'otros';
  }

  const moneda = normalizarMoneda(m.moneda);
  // null / vacío NO es 0: sin monto en pesos se usa el monto original.
  const crudoPesos = m.montoPesos;
  const montoPesos = crudoPesos === null || crudoPesos === undefined || crudoPesos === '' ? NaN : Number(crudoPesos);
  const idMov = m.idMov || idSintetico('mig', userId, [m.fecha, m.hora, m.descripcion, monto, tipo, moneda]);

  return {
    ok: true,
    aviso,
    movimiento: {
      idMov,
      fecha: m.fecha,
      hora: m.hora || null,
      descripcion: String(m.descripcion || '').trim(),
      monto,
      tipo,
      moneda,
      montoPesos: Number.isFinite(montoPesos) && montoPesos >= 0 ? montoPesos : monto,
      metodoPago: m.metodoPago || null,
      categoria,
      comercio: m.comercio || null,
      viajeId: m.viajeId || null,
      notas: m.notas || null,
      origenCarga: 'migracion',
    },
  };
}

function mapearViaje(v, userId) {
  const nombre = String((v && v.nombre) || '').trim();
  if (!nombre) return { ok: false, motivo: 'sin_nombre' };
  const presupuesto = Number(v.presupuesto);
  return {
    ok: true,
    viaje: {
      idViaje: v.idViaje || idSintetico('viaje_mig', userId, [nombre, v.fechaInicio, v.fechaFin]),
      nombre,
      fechaInicio: v.fechaInicio || '',
      fechaFin: v.fechaFin || '',
      estado: String(v.estado || '').trim().toLowerCase() === 'activo' ? 'activo' : 'cerrado',
      presupuesto: Number.isFinite(presupuesto) && presupuesto >= 0 && v.presupuesto !== '' && v.presupuesto != null ? presupuesto : null,
      moneda: normalizarMoneda(v.moneda),
    },
  };
}

// La base permite un solo viaje activo por persona: si el Sheet tiene varios, queda activo
// el último y el resto se importa como cerrado.
function unSoloViajeActivo(viajes) {
  const idxActivos = viajes.map((v, i) => (v.estado === 'activo' ? i : -1)).filter(i => i >= 0);
  const ultimo = idxActivos[idxActivos.length - 1];
  return viajes.map((v, i) => (v.estado === 'activo' && i !== ultimo ? { ...v, estado: 'cerrado' } : v));
}

function mapearPresupuesto(p) {
  const categoria = String((p && p.categoria) || '').trim().toLowerCase();
  const monto = Number(p && p.montoMensual);
  if (!categoria) return { ok: false, motivo: 'sin_categoria' };
  if (!Number.isFinite(monto) || monto <= 0) return { ok: false, motivo: 'monto_invalido' };
  return { ok: true, presupuesto: { categoria, montoMensual: monto, moneda: normalizarMoneda(p.moneda) } };
}

function mapearPreferencia(termino, ambito) {
  const t = String(termino || '').trim().toLowerCase();
  const a = String(ambito || '').trim().toLowerCase();
  if (!t || t.length > 80) return { ok: false, motivo: 'termino_invalido' };
  if (!(a === 'personal' || a === 'consultorio' || /^casa:[a-z0-9_]+$/.test(a))) return { ok: false, motivo: 'ambito_invalido' };
  return { ok: true, termino: t, ambito: a };
}

function contar(lista) {
  const porMotivo = {};
  for (const d of lista) porMotivo[d.motivo] = (porMotivo[d.motivo] || 0) + 1;
  return porMotivo;
}

/**
 * Importa el Personal de UNA persona.
 * @param {object} args
 * @param {string|number} args.userId
 * @param {{movimientos:Array, viajes:Array, presupuestos:Array, preferencias:Object}} args.datos  lo leído del Sheet
 * @param {object} args.repo     personal-repo.supabase (o uno falso en tests)
 * @param {boolean} args.aplicar false = simulacro: calcula el informe y NO escribe nada
 */
async function importarPersona({ userId, datos, repo, aplicar = false }) {
  const informe = {
    userId: String(userId),
    aplicado: Boolean(aplicar),
    movimientos: { leidos: 0, aImportar: 0, yaExistentes: 0, importados: 0, descartados: [], avisos: [] },
    viajes: { leidos: 0, aImportar: 0, yaExistentes: 0, importados: 0, descartados: [] },
    presupuestos: { leidos: 0, aImportar: 0, importados: 0, descartados: [] },
    preferencias: { leidas: 0, aImportar: 0, importadas: 0, descartadas: [] },
  };

  // ── Movimientos ──
  const yaMovs = new Set((await repo.listarMovimientos(userId)).map(m => m.idMov));
  const vistos = new Set();
  const movs = [];
  for (const crudo of datos.movimientos || []) {
    informe.movimientos.leidos++;
    const r = mapearMovimiento(crudo, userId);
    if (!r.ok) { informe.movimientos.descartados.push({ idMov: crudo && crudo.idMov, motivo: r.motivo }); continue; }
    if (r.aviso) informe.movimientos.avisos.push({ idMov: r.movimiento.idMov, aviso: r.aviso });
    const id = r.movimiento.idMov;
    if (yaMovs.has(id) || vistos.has(id)) { informe.movimientos.yaExistentes++; continue; }
    vistos.add(id);
    movs.push(r.movimiento);
  }
  informe.movimientos.aImportar = movs.length;

  // ── Viajes ──
  const yaViajes = new Map((await repo.listarViajes(userId)).map(v => [v.idViaje, v]));
  const viajesMap = [];
  for (const crudo of datos.viajes || []) {
    informe.viajes.leidos++;
    const r = mapearViaje(crudo, userId);
    if (!r.ok) informe.viajes.descartados.push({ nombre: crudo && crudo.nombre, motivo: r.motivo });
    else viajesMap.push(r.viaje);
  }
  // Si ya hay un viaje activo en la base, ningún otro puede entrar como activo.
  const hayActivoEnBase = [...yaViajes.values()].some(v => v.estado === 'activo');
  const viajes = unSoloViajeActivo(viajesMap).map(v => (hayActivoEnBase && v.estado === 'activo' ? { ...v, estado: 'cerrado' } : v));
  const viajesNuevos = viajes.filter(v => !yaViajes.has(v.idViaje));
  informe.viajes.yaExistentes = viajes.length - viajesNuevos.length;
  informe.viajes.aImportar = viajesNuevos.length;

  // ── Presupuestos y preferencias (upsert: siempre idempotentes) ──
  const presupuestos = [];
  for (const crudo of datos.presupuestos || []) {
    informe.presupuestos.leidos++;
    const r = mapearPresupuesto(crudo);
    if (!r.ok) informe.presupuestos.descartados.push({ categoria: crudo && crudo.categoria, motivo: r.motivo });
    else presupuestos.push(r.presupuesto);
  }
  informe.presupuestos.aImportar = presupuestos.length;

  const preferencias = [];
  for (const [termino, ambito] of Object.entries(datos.preferencias || {})) {
    informe.preferencias.leidas++;
    const r = mapearPreferencia(termino, ambito);
    if (!r.ok) informe.preferencias.descartadas.push({ termino, motivo: r.motivo });
    else preferencias.push(r);
  }
  informe.preferencias.aImportar = preferencias.length;

  if (!aplicar) return informe;

  // ── Escritura ──
  // Los viajes van primero: los movimientos los referencian por su id.
  for (const v of viajesNuevos) {
    await repo.crearViaje(userId, v, { createdBy: userId, estado: v.estado });
    informe.viajes.importados++;
  }
  for (const m of movs) {
    await repo.insertarMovimiento(userId, m, { createdBy: userId });
    informe.movimientos.importados++;
  }
  for (const p of presupuestos) {
    await repo.guardarPresupuesto(userId, p.categoria, p.montoMensual, p.moneda, { createdBy: userId });
    informe.presupuestos.importados++;
  }
  for (const pr of preferencias) {
    await repo.guardarPreferencia(userId, pr.termino, pr.ambito);
    informe.preferencias.importadas++;
  }
  return informe;
}

module.exports = {
  importarPersona,
  mapearMovimiento,
  mapearViaje,
  unSoloViajeActivo,
  mapearPresupuesto,
  mapearPreferencia,
  idSintetico,
  contar,
};
