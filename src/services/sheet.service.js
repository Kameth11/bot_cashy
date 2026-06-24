const { USE_SUPABASE } = require('../config');
const { GoogleSpreadsheet, serviceAccountAuth } = require('../lib/google');
const { SPREADSHEET_ID } = require('../config');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const state = require('../state');
const { toMovimiento, isValidMovimientoRow } = require('../utils/sheet-row');

const REQUIRED_SHEET_HEADERS = [
  'Fecha',
  'Hora',
  'Descripcion',
  'Monto',
  'Estado',
  'Tipo',
  'Moneda',
  'MetodoPago',
  'ID_Unico',
  'MontoPesos',
  'ID_Origen',
  'Categoria',
  'Paciente',
  'Pagador',
  'Profesional',
  'Tratamiento',
  'Proveedor',
  'FechaPrestacion',
  'FechaVencimiento',
  'SaldoPendiente',
  'ReferenciaId',
];

function normalizarHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function ensureSheetStructure(sheet) {
  if (!sheet) return { created: [], existing: [] };

  const requiredHeaders = REQUIRED_SHEET_HEADERS;

  try {
    await sheet.loadHeaderRow();
  } catch (error) {
    // Some sheets do not have a valid header row yet.
  }

  const currentHeaders = Array.isArray(sheet.headerValues) ? sheet.headerValues : [];
  const normalizedExisting = new Set(currentHeaders.map(normalizarHeader).filter(Boolean));
  const missingHeaders = requiredHeaders.filter(header => !normalizedExisting.has(normalizarHeader(header)));

  if (currentHeaders.length === 0) {
    const requiredColumnCount = Math.max(sheet.columnCount || 0, requiredHeaders.length);
    const requiredRowCount = Math.max(sheet.rowCount || 0, 2);
    if ((sheet.columnCount || 0) < requiredColumnCount || (sheet.rowCount || 0) < requiredRowCount) {
      await sheet.resize({ rowCount: requiredRowCount, columnCount: requiredColumnCount });
    }

    const endColumnLetter = String.fromCharCode(64 + Math.min(requiredHeaders.length, 26));
    if (requiredHeaders.length > 26) {
      await sheet.loadCells({ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: requiredHeaders.length });
    } else {
      await sheet.loadCells(`A1:${endColumnLetter}1`);
    }

    requiredHeaders.forEach((header, index) => {
      const cell = sheet.getCell(0, index);
      cell.value = header;
      cell.textFormat = { bold: true };
    });
    await sheet.saveUpdatedCells();
    await sheet.loadHeaderRow();

    return { created: [...requiredHeaders], existing: [] };
  }

  if (missingHeaders.length === 0) {
    return { created: [], existing: currentHeaders };
  }

  const finalHeaders = [...currentHeaders, ...missingHeaders];
  const requiredColumnCount = Math.max(sheet.columnCount || 0, finalHeaders.length);
  if ((sheet.columnCount || 0) < requiredColumnCount) {
    await sheet.resize({ rowCount: sheet.rowCount || 2, columnCount: requiredColumnCount });
  }

  await sheet.loadCells({ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: finalHeaders.length });
  missingHeaders.forEach((header, index) => {
    const cell = sheet.getCell(0, currentHeaders.length + index);
    cell.value = header;
    cell.textFormat = { bold: true };
  });
  await sheet.saveUpdatedCells();
  await sheet.loadHeaderRow();

  return { created: missingHeaders, existing: currentHeaders };
}

function getDbService() {
  return USE_SUPABASE ? require('./db.service') : null;
}

function getSheetId(userId) {
  const cliente = obtenerClientePorUserId(userId);
  if (cliente && cliente.sheetId) return cliente.sheetId;
  if (esAdminOriginal(userId) && SPREADSHEET_ID) return SPREADSHEET_ID;
  return null;
}

function invalidateCache(userId) {
  state.docsCache.delete(userId);
}

async function getDocCliente(userId, fresh = false) {
  const sheetId = getSheetId(userId);
  if (!sheetId) return null;

  if (fresh || !state.docsCache.has(userId)) {
    const docCliente = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await docCliente.loadInfo();
    state.docsCache.set(userId, docCliente);
  }

  return state.docsCache.get(userId);
}

async function getSheetCliente(userId) {
  // Reusa el documento cacheado (TTL 2h) en vez de rehacer loadInfo() en cada
  // llamada. No hace falta loadCells(): addRow/getRows y el formateo de color
  // (aplicarColorMontoEnFila) van directo a la API, no a la grilla en memoria.
  const docCliente = await getDocCliente(userId, false);
  if (!docCliente) return null;
  const sheet = docCliente.sheetsByIndex[0];
  if (!sheet) return null;
  return sheet;
}

async function obtenerDatosSheet(userId) {
  const db = getDbService();
  if (db) return db.obtenerDatosSheet(userId);
  const sheetId = getSheetId(userId);
  if (!sheetId) {
    console.error('No se encontro sheetId para userId:', userId);
    return [];
  }

  const docCliente = await getDocCliente(userId, false);
  if (!docCliente) return [];
  const sheet = docCliente.sheetsByIndex[0];
  if (!sheet) return [];
  const filas = await sheet.getRows();

  const datos = filas.map(toMovimiento);
  return datos.filter(isValidMovimientoRow);
}

module.exports = {
  REQUIRED_SHEET_HEADERS,
  ensureSheetStructure,
  getSheetId,
  invalidateCache,
  getDocCliente,
  getSheetCliente,
  obtenerDatosSheet,
};
