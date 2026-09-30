// Comprobantes (facturas, tickets, transferencias) leídos de fotos/PDFs.
//
// Fuente de verdad: pestaña "Comprobantes" en el sheet del dueño (mismo
// patrón que "Personal" o "Turnos"). Cada comprobante queda vinculado a su
// movimiento por ReferenciaId = "comp:<ID_Comprobante>" (consultorio) o por
// Notas (personal), y guarda los datos fiscales, los ítems y dónde está el
// archivo original. Ver PLAN_COMPROBANTES.md.

const crypto = require('crypto');
const { getDocCliente, invalidateCache } = require('./sheet.service');
const { withUserWriteLock } = require('../lib/write-queue');
const logger = require('../lib/logger');
const { fechaArgentinaStr, horaArgentinaStr, normalizarFecha, ahoraArgentina } = require('../utils/date');

const TAB_COMPROBANTES = 'Comprobantes';
const COLS_COMPROBANTES = [
  'ID_Comprobante', 'FechaCarga', 'Tipo', 'Ambito', 'Emisor', 'CUIT',
  'TipoComprobante', 'Numero', 'FechaEmision', 'FechaVencimiento', 'Total',
  'Moneda', 'Hash', 'Archivo', 'MimeType', 'ID_Movimiento', 'Items',
  'CargadoPor',
];

const PREFIJO_REFERENCIA = 'comp:';

function generarIdComprobante() {
  return `comp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function hashArchivo(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ── Pestaña ──────────────────────────────────────────────────────────────────

async function getTabComprobantes(userId, fresh = false) {
  const doc = await getDocCliente(userId, fresh);
  if (!doc) return null;

  let sheet = doc.sheetsByTitle[TAB_COMPROBANTES];
  if (sheet) {
    let headerValues = null;
    try {
      await sheet.loadHeaderRow();
      headerValues = sheet.headerValues;
    } catch (_) {
      headerValues = null;
    }
    if (!Array.isArray(headerValues) || headerValues.length === 0) {
      await sheet.setHeaderRow(COLS_COMPROBANTES);
      await sheet.loadHeaderRow();
    }
    return sheet;
  }

  sheet = await doc.addSheet({ title: TAB_COMPROBANTES });
  await sheet.setHeaderRow(COLS_COMPROBANTES);
  await sheet.loadHeaderRow();
  return sheet;
}

function rowToComprobante(r) {
  const get = (k) => (typeof r.get === 'function' ? r.get(k) : r[k]) || '';
  return {
    id: get('ID_Comprobante'),
    fechaCarga: get('FechaCarga'),
    tipo: get('Tipo'),
    ambito: get('Ambito'),
    emisor: get('Emisor'),
    cuit: get('CUIT'),
    tipoComprobante: get('TipoComprobante'),
    numero: get('Numero'),
    fechaEmision: get('FechaEmision'),
    fechaVencimiento: get('FechaVencimiento'),
    total: Number(get('Total')) || 0,
    moneda: get('Moneda'),
    hash: get('Hash'),
    archivo: get('Archivo'),
    mimeType: get('MimeType'),
    idMovimiento: get('ID_Movimiento'),
    items: parsearItems(get('Items')),
    cargadoPor: get('CargadoPor'),
  };
}

function parsearItems(value) {
  if (!value) return [];
  try {
    const items = JSON.parse(value);
    return Array.isArray(items) ? items : [];
  } catch (_) {
    return [];
  }
}

async function listarComprobantes(userId) {
  const sheet = await getTabComprobantes(userId);
  if (!sheet) return [];
  const rows = await sheet.getRows();
  return rows.map(rowToComprobante);
}

// ── Duplicados (puro) ────────────────────────────────────────────────────────

function normalizarClave(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// "0003-00001234", "3-1234" y "0003 00001234" son el mismo número: se
// compara cada bloque sin ceros a la izquierda.
function normalizarNumero(value) {
  return String(value || '')
    .split(/[^0-9a-z]+/i)
    .map(b => b.replace(/^0+(?=.)/, '').toLowerCase())
    .filter(Boolean)
    .join('-');
}

// Un comprobante es el mismo si es el mismo archivo (hash) o si coinciden
// emisor (CUIT, o nombre si no hay CUIT) + número + total. Sin número no se
// compara por datos: dos tickets del mismo súper por el mismo monto pueden
// ser compras distintas.
function buscarDuplicadoEn(existentes, { hash, cuit, emisor, numero, total }) {
  if (hash) {
    const mismoArchivo = existentes.find(c => c.hash && c.hash === hash);
    if (mismoArchivo) return { motivo: 'mismo_archivo', comprobante: mismoArchivo };
  }
  const numeroClave = normalizarNumero(numero);
  if (!numeroClave || !total) return null;
  const emisorClave = normalizarClave(cuit) || normalizarClave(emisor);
  if (!emisorClave) return null;

  const mismoDato = existentes.find(c => {
    const cEmisor = normalizarClave(c.cuit) || normalizarClave(c.emisor);
    return cEmisor === emisorClave
      && normalizarNumero(c.numero) === numeroClave
      && Math.abs(Number(c.total) - Number(total)) < 0.01;
  });
  return mismoDato ? { motivo: 'mismos_datos', comprobante: mismoDato } : null;
}

async function buscarDuplicado(userId, datos) {
  try {
    return buscarDuplicadoEn(await listarComprobantes(userId), datos);
  } catch (err) {
    // No poder chequear duplicados no puede frenar la carga.
    logger.warn('Comprobantes', 'No se pudieron leer comprobantes para duplicados', { err: err.message });
    return null;
  }
}

// ── Alta ─────────────────────────────────────────────────────────────────────

async function registrarComprobante(userId, c) {
  const id = c.id || generarIdComprobante();
  return withUserWriteLock(userId, async () => {
    const sheet = await getTabComprobantes(userId);
    if (!sheet) throw new Error('sin_sheet');
    await sheet.addRow({
      ID_Comprobante: id,
      FechaCarga: `${fechaArgentinaStr()} ${horaArgentinaStr()}`,
      Tipo: c.tipo || 'factura',
      Ambito: c.ambito || 'consultorio',
      Emisor: c.emisor || '',
      CUIT: c.cuit || '',
      TipoComprobante: [c.tipoDocumento, c.letra].filter(Boolean).join(' '),
      Numero: c.numero || '',
      FechaEmision: c.fechaEmision || '',
      FechaVencimiento: c.fechaVencimiento || '',
      Total: c.total ?? '',
      Moneda: c.moneda || 'Pesos',
      Hash: c.hash || '',
      Archivo: c.archivo || '',
      MimeType: c.mimeType || '',
      ID_Movimiento: c.idMovimiento || '',
      Items: c.items && c.items.length ? JSON.stringify(c.items) : '',
      CargadoPor: String(c.cargadoPor || userId),
    });
    invalidateCache(userId);
    logger.audit('comprobante_registrado', { userId, id, tipo: c.tipo, ambito: c.ambito });
    return id;
  });
}

// ── Factura -> movimiento (puro) ─────────────────────────────────────────────

// Pendiente si el comprobante dice que no está pago, o si tiene vencimiento
// que todavía no pasó y nada indica que se pagó.
function decidirEstado(factura, hoy = ahoraArgentina()) {
  if (factura.pagado === true) return 'Cobrado';
  if (factura.pagado === false) return 'Pendiente';
  const vto = normalizarFecha(factura.fechaVencimiento);
  if (vto) {
    const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    return vto >= inicioHoy ? 'Pendiente' : 'Cobrado';
  }
  return 'Cobrado';
}

// Arma las mismas `entities` que produce el NLP de texto para un gasto, así
// el comprobante pasa por la misma confirmación (nlp-confirm.js) y el mismo
// guardado que "gasté 5000 en insumos".
function facturaAEntities(factura, { idComprobante, duplicado = null } = {}) {
  const estado = decidirEstado(factura);
  return {
    tipo: 'gasto',
    descripcion: factura.descripcion || factura.emisor || 'Comprobante',
    monto: factura.total,
    moneda: factura.moneda || 'Pesos',
    metodo_pago: factura.metodoPago || null,
    estado,
    categoria: factura.categoria || 'otro_egreso',
    proveedorNombre: factura.emisor || null,
    pacienteNombre: null,
    pagadorNombre: null,
    profesionalNombre: null,
    tratamientoNombre: null,
    fechaPrestacion: factura.fechaEmision || null,
    fechaVencimiento: factura.fechaVencimiento || null,
    fecha: factura.fechaEmision || null,
    comercio: factura.emisor || null,
    referenciaId: `${PREFIJO_REFERENCIA}${idComprobante}`,
    comprobante: {
      id: idComprobante,
      tipo: 'factura',
      tipoDocumento: factura.tipoDocumento,
      letra: factura.letra,
      emisor: factura.emisor,
      cuit: factura.cuit,
      numero: factura.numero,
      fechaEmision: factura.fechaEmision,
      fechaVencimiento: factura.fechaVencimiento,
      total: factura.total,
      moneda: factura.moneda,
      items: factura.items || [],
      rubro: factura.rubro,
      duplicado,
    },
  };
}

// Texto que se le pasa al detector de ámbito (personal vs consultorio): el
// rubro y el emisor dicen más que la descripción ("supermercado", "YPF").
function textoParaAmbito(factura) {
  return [factura.rubro, factura.emisor, factura.descripcion, factura.categoria]
    .filter(Boolean).join(' ');
}

module.exports = {
  TAB_COMPROBANTES,
  COLS_COMPROBANTES,
  PREFIJO_REFERENCIA,
  generarIdComprobante,
  hashArchivo,
  listarComprobantes,
  buscarDuplicado,
  buscarDuplicadoEn,
  registrarComprobante,
  decidirEstado,
  facturaAEntities,
  textoParaAmbito,
};
