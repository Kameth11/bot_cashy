// Archivo original de los comprobantes + copia del comprobante en Supabase
// (fase 3 de PLAN_COMPROBANTES.md).
//
// - Mientras el usuario confirma, el archivo queda en memoria (TTL) y recién
//   se sube al tocar "Guardar": así un comprobante cancelado no deja basura
//   en el bucket.
// - Con Supabase (tabla + bucket de sql/migrations/011_comprobantes.sql) se
//   sube al bucket privado "comprobantes" y se referencia como "sb:<path>".
//   Sin Supabase, o si la subida falla, queda el "tg:<file_id>" de Telegram,
//   que el bot puede volver a bajar cuando quiera.
// - El dashboard nunca ve una URL del bucket: pide el archivo a la API, que
//   chequea permisos y lo baja con la service role key.

const axios = require('axios');
const state = require('../state');
const { getSupabase, isAvailable } = require('../lib/supabase');
const { forTenant } = require('../lib/tenant-db');
const { resolveTenantId } = require('./tenant.service');
const logger = require('../lib/logger');
const { normalizarFecha } = require('../utils/date');

const BUCKET = 'comprobantes';
const EXTENSIONES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// state.pendingComprobanteArchivos: id_comprobante -> { buffer, mimeType }.
// 15 min: más que el TTL de la confirmación (5 min) más el paso de método de
// pago.
const archivosPendientes = state.pendingComprobanteArchivos;

function recordarArchivo(idComprobante, { buffer, mimeType }) {
  if (idComprobante && buffer) archivosPendientes.set(idComprobante, { buffer, mimeType });
}

function tomarArchivo(idComprobante) {
  const a = archivosPendientes.get(idComprobante);
  archivosPendientes.delete(idComprobante);
  return a || null;
}

// ── Capacidades (tabla y bucket existen) ─────────────────────────────────────

let capPromise = null;

function isMissingError(error) {
  return Boolean(error && /does not exist|could not find|not found/i.test(error.message || ''));
}

async function resolverCapacidades() {
  if (!isAvailable()) return { tabla: false, bucket: false };
  if (capPromise) return capPromise;
  capPromise = (async () => {
    const supabase = getSupabase();
    const caps = { tabla: false, bucket: false };
    // tenant-isolation-ignore: sonda de existencia de la tabla (head:true, no
    // trae filas), mismo criterio que personal.service.js.
    const check = await supabase.from('comprobantes').select('id', { head: true, count: 'exact' });
    if (!check.error) caps.tabla = true;
    else if (!isMissingError(check.error)) logger.warn('Comprobantes', 'Chequeo de tabla comprobantes falló', { err: check.error.message });

    const bucket = await supabase.storage.getBucket(BUCKET);
    if (!bucket.error) caps.bucket = true;
    else if (!isMissingError(bucket.error)) logger.warn('Comprobantes', 'Chequeo de bucket comprobantes falló', { err: bucket.error.message });

    if (!caps.tabla || !caps.bucket) {
      logger.info('Comprobantes', 'Supabase sin tabla/bucket de comprobantes (correr sql/migrations/011_comprobantes.sql); se usa solo Sheets + Telegram', caps);
    }
    return caps;
  })();
  return capPromise;
}

// ── Subida / descarga ────────────────────────────────────────────────────────

function pathArchivo(tenantId, idComprobante, mimeType, ahora = new Date()) {
  const mes = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
  const ext = EXTENSIONES[mimeType] || 'bin';
  return `${tenantId}/${mes}/${idComprobante}.${ext}`;
}

// Devuelve "sb:<path>" o null si no se pudo (sin Supabase, sin bucket, error).
async function subirArchivo(userId, idComprobante, { buffer, mimeType }) {
  const caps = await resolverCapacidades();
  if (!caps.bucket) return null;
  const tenantId = await resolveTenantId(userId);
  if (!tenantId) return null;

  const path = pathArchivo(tenantId, idComprobante, mimeType);
  // tenant-isolation-ignore: Storage, no una tabla. El aislamiento es el
  // prefijo <tenant_id>/ del path, que arma el backend (nunca el cliente).
  const { error } = await getSupabase().storage.from(BUCKET).upload(path, buffer, {
    contentType: mimeType || 'application/octet-stream',
    upsert: true,
  });
  if (error) {
    logger.error('Comprobantes', 'No se pudo subir el archivo al bucket', { userId, idComprobante, err: error.message });
    return null;
  }
  return `sb:${path}`;
}

// Baja el archivo de donde esté. `userId` es quien lo pide: para "sb:" se
// verifica que el path sea de SU tenant (defensa extra además de que el
// comprobante salió de su propio sheet).
async function descargarArchivo(userId, archivo) {
  const ref = String(archivo || '');
  if (ref.startsWith('sb:')) {
    const path = ref.slice(3);
    const tenantId = await resolveTenantId(userId);
    if (!tenantId || !path.startsWith(`${tenantId}/`)) return null;
    if (!isAvailable()) return null;
    // tenant-isolation-ignore: Storage; path validado contra el tenant arriba.
    const { data, error } = await getSupabase().storage.from(BUCKET).download(path);
    if (error || !data) {
      logger.error('Comprobantes', 'No se pudo bajar el archivo del bucket', { userId, err: error?.message });
      return null;
    }
    return Buffer.from(await data.arrayBuffer());
  }
  if (ref.startsWith('tg:')) {
    const { bot } = require('../lib/telegraf');
    const link = await bot.telegram.getFileLink(ref.slice(3));
    const res = await axios.get(link.href, { responseType: 'arraybuffer', timeout: 20000 });
    return Buffer.from(res.data);
  }
  return null;
}

// ── Copia del comprobante en Supabase ────────────────────────────────────────

function fechaIso(ddmmyyyy) {
  const d = normalizarFecha(ddmmyyyy);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function aFilaSupabase(c) {
  return {
    legacy_id: c.id,
    tipo: c.tipo === 'transferencia' ? 'transferencia' : 'factura',
    ambito: c.ambito === 'personal' ? 'personal' : 'consultorio',
    emisor: c.emisor || null,
    cuit: c.cuit || null,
    tipo_comprobante: [c.tipoDocumento, c.letra].filter(Boolean).join(' ') || null,
    numero: c.numero || null,
    fecha_emision: fechaIso(c.fechaEmision),
    fecha_vencimiento: fechaIso(c.fechaVencimiento),
    total: Number.isFinite(Number(c.total)) ? Number(c.total) : null,
    moneda: c.moneda || 'Pesos',
    hash: c.hash || null,
    archivo: c.archivo || null,
    mime_type: c.mimeType || null,
    id_movimiento: c.idMovimiento || null,
    items: Array.isArray(c.items) ? c.items : [],
    cargado_por: Number(c.cargadoPor) || null,
  };
}

// Best-effort: el Sheet ya tiene el comprobante; esto no puede frenar nada.
async function guardarEnSupabase(userId, c) {
  try {
    const caps = await resolverCapacidades();
    if (!caps.tabla) return false;
    const tenantId = await resolveTenantId(userId);
    if (!tenantId) return false;
    const { error } = await forTenant(tenantId)
      .from('comprobantes')
      .upsert(aFilaSupabase(c), { onConflict: 'tenant_id,legacy_id' });
    if (error) {
      logger.error('Comprobantes', 'No se pudo copiar el comprobante a Supabase', { userId, id: c.id, err: error.message });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('Comprobantes', 'No se pudo copiar el comprobante a Supabase', { userId, id: c.id, err: err.message });
    return false;
  }
}

async function vincularMovimientoEnSupabase(userId, idComprobante, idMovimiento) {
  try {
    const caps = await resolverCapacidades();
    if (!caps.tabla) return;
    const tenantId = await resolveTenantId(userId);
    if (!tenantId) return;
    const { error } = await forTenant(tenantId)
      .from('comprobantes')
      .update({ id_movimiento: idMovimiento })
      .eq('legacy_id', idComprobante);
    if (error) logger.warn('Comprobantes', 'No se pudo vincular el movimiento en Supabase', { userId, idComprobante, err: error.message });
  } catch (err) {
    logger.warn('Comprobantes', 'No se pudo vincular el movimiento en Supabase', { userId, idComprobante, err: err.message });
  }
}

function _resetCapacidades() { capPromise = null; }

module.exports = {
  BUCKET,
  recordarArchivo,
  tomarArchivo,
  resolverCapacidades,
  pathArchivo,
  subirArchivo,
  descargarArchivo,
  aFilaSupabase,
  guardarEnSupabase,
  vincularMovimientoEnSupabase,
  _resetCapacidades,
};
