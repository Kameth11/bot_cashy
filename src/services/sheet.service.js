const { GoogleSpreadsheet, serviceAccountAuth } = require('../lib/google');
const { SPREADSHEET_ID } = require('../config');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const state = require('../state');

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
  const docCliente = await getDocCliente(userId, true);
  if (!docCliente) return null;
  const sheet = docCliente.sheetsByIndex[0];
  await sheet.loadCells();
  return sheet;
}

async function obtenerDatosSheet(userId) {
  const sheetId = getSheetId(userId);
  if (!sheetId) {
    console.error('No se encontro sheetId para userId:', userId);
    return [];
  }

  invalidateCache(userId);
  const docCliente = await getDocCliente(userId, true);
  const sheet = docCliente.sheetsByIndex[0];
  await sheet.loadCells();
  const filas = await sheet.getRows();

  const datos = filas.map(row => {
    const rowObj = row.toObject ? row.toObject() : row;
    return {
      fecha: rowObj.Fecha || rowObj.fecha || '',
      hora: rowObj.Hora || rowObj.hora || '',
      descripcion: rowObj.Descripcion || rowObj.descripcion || rowObj.Paciente || '',
      monto: parseFloat(rowObj.Monto || rowObj.monto || 0),
      montoPesos: parseFloat(rowObj.MontoPesos || rowObj.montopesos || rowObj.Monto || rowObj.monto || 0),
      estado: rowObj.Estado || rowObj.estado || '',
      tipo: rowObj.Tipo || rowObj.tipo || '',
      moneda: rowObj.Moneda || rowObj.moneda || 'Pesos',
      metodoPago: rowObj.MetodoPago || rowObj.metodopago || '',
      idUnico: rowObj.ID_unico || rowObj.ID_uNico || rowObj.idunico || ''
    };
  });

  return datos.filter(d => 
    d.fecha && d.fecha.trim() !== '' &&
    d.descripcion && d.descripcion.trim() !== '' &&
    d.monto && d.monto !== 0
  );
}

module.exports = {
  getSheetId,
  invalidateCache,
  getDocCliente,
  getSheetCliente,
  obtenerDatosSheet,
};
