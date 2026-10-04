// Acceso a pestañas auxiliares del spreadsheet de una cuenta (Personal, Casas,
// ...), con auto-creación. Espeja crearTabTurnosSiNoExiste (agenda.service.js):
// el getter headerValues TIRA si el header no está cargado, así que hay que
// probarlo dentro del try, y una tab que quedó a medio crear se rearma en vez
// de fallar.

const { getDocCliente } = require('./sheet.service');

async function getOrCreateTab(userId, title, cols, fresh = false) {
  const doc = await getDocCliente(userId, fresh);
  if (!doc) return null;

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
async function getOrCreateTabConReintento(userId, title, cols) {
  const sheet = await getOrCreateTab(userId, title, cols);
  if (sheet) return sheet;
  return getOrCreateTab(userId, title, cols, true);
}

module.exports = { getOrCreateTab, getOrCreateTabConReintento };
