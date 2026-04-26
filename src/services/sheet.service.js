const { USE_SUPABASE } = require('../config');
const { GoogleSpreadsheet, serviceAccountAuth } = require('../lib/google');
const { SPREADSHEET_ID } = require('../config');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const state = require('../state');
const { toMovimiento, isValidMovimientoRow } = require('../utils/sheet-row');

const db = USE_SUPABASE ? require('./db.service') : null;

function getSheetId(userId) {
  if (db) return db.getSheetId(userId);
  const cliente = obtenerClientePorUserId(userId);
  if (cliente && cliente.sheetId) return cliente.sheetId;
  if (esAdminOriginal(userId) && SPREADSHEET_ID) return SPREADSHEET_ID;
  return null;
}

function invalidateCache(userId) {
  if (db) return db.invalidateCache(userId);
  state.docsCache.delete(userId);
}

async function getDocCliente(userId, fresh = false) {
  if (db) return db.getDocCliente(userId);
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
  if (db) return db.getSheetCliente(userId);
  const docCliente = await getDocCliente(userId, true);
  if (!docCliente) return null;
  const sheet = docCliente.sheetsByIndex[0];
  if (!sheet) return null;
  await sheet.loadCells();
  return sheet;
}

async function obtenerDatosSheet(userId) {
  if (db) return db.obtenerDatosSheet(userId);
  const sheetId = getSheetId(userId);
  if (!sheetId) {
    console.error('No se encontro sheetId para userId:', userId);
    return [];
  }

  invalidateCache(userId);
  const docCliente = await getDocCliente(userId, true);
  if (!docCliente) return [];
  const sheet = docCliente.sheetsByIndex[0];
  if (!sheet) return [];
  await sheet.loadCells();
  const filas = await sheet.getRows();

  const datos = filas.map(toMovimiento);
  return datos.filter(isValidMovimientoRow);
}

module.exports = {
  getSheetId,
  invalidateCache,
  getDocCliente,
  getSheetCliente,
  obtenerDatosSheet,
};
