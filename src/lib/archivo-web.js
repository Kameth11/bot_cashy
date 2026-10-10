// Los archivos que llegan por el chat web no tienen file_id de Telegram: el
// canal web les inventa uno con este prefijo para que los handlers (photo.js)
// los traten como cualquier otro archivo recibido. Hay que reconocerlos para no
// guardar una referencia "tg:web-..." que no existe en Telegram.
const PREFIJO_ARCHIVO_WEB = 'web-';

function esArchivoWeb(fileId) {
  return typeof fileId === 'string' && fileId.startsWith(PREFIJO_ARCHIVO_WEB);
}

module.exports = { PREFIJO_ARCHIVO_WEB, esArchivoWeb };
