const COLOR_MONTO_POSITIVO = { red: 0.11, green: 0.62, blue: 0.32 };
const COLOR_MONTO_NEGATIVO = { red: 0.84, green: 0.19, blue: 0.15 };
const COLOR_MONTO_PENDIENTE_TEXTO = { red: 0, green: 0, blue: 0 };
const COLOR_MONTO_PENDIENTE_FONDO = { red: 0.98, green: 0.88, blue: 0.72 };
const COLOR_MONTO_NEUTRO = { red: 0, green: 0, blue: 0 };
const COLOR_FONDO_NEUTRO = { red: 1, green: 1, blue: 1 };

function normalizarHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function getMontoStyle(monto, estado) {
  if (String(estado || '').trim().toLowerCase() === 'pendiente') {
    return {
      foregroundColor: COLOR_MONTO_PENDIENTE_TEXTO,
      backgroundColor: COLOR_MONTO_PENDIENTE_FONDO,
    };
  }

  if (monto > 0) {
    return {
      foregroundColor: COLOR_MONTO_POSITIVO,
      backgroundColor: COLOR_FONDO_NEUTRO,
    };
  }

  if (monto < 0) {
    return {
      foregroundColor: COLOR_MONTO_NEGATIVO,
      backgroundColor: COLOR_FONDO_NEUTRO,
    };
  }

  return {
    foregroundColor: COLOR_MONTO_NEUTRO,
    backgroundColor: COLOR_FONDO_NEUTRO,
  };
}

async function aplicarColorMontoEnFila(fila, monto, estado) {
  if (!fila || !fila._worksheet || typeof fila.rowNumber !== 'number') {
    return;
  }

  const sheet = fila._worksheet;
  // Los encabezados ya los deja cargados ensureSheetStructure/addRow (que
  // refrescan cada tanto): releerlos acá era una llamada extra a la API por
  // escritura. Solo se cargan si todavía no están.
  let headers;
  try { headers = sheet.headerValues; } catch (_) { headers = null; }
  if (!headers) {
    await sheet.loadHeaderRow();
    headers = sheet.headerValues;
  }

  const columnIndexes = headers.reduce((acc, header, index) => {
    const normalized = normalizarHeader(header);
    if (['monto', 'montopesos', 'montoenpesos', 'estado'].includes(normalized)) {
      acc.push(index);
    }
    return acc;
  }, []);

  if (columnIndexes.length === 0) {
    return;
  }

  const montoNumerico = parseFloat(monto);
  const { foregroundColor, backgroundColor } = getMontoStyle(Number.isFinite(montoNumerico) ? montoNumerico : 0, estado);

  // Un solo batchUpdate para todas las columnas (antes: una llamada por
  // columna, hasta 3 por escritura).
  const requests = columnIndexes.map(columnIndex => ({
    repeatCell: {
      range: {
        sheetId: sheet.sheetId,
        startRowIndex: fila.rowNumber - 1,
        endRowIndex: fila.rowNumber,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor,
          backgroundColorStyle: {
            rgbColor: backgroundColor,
          },
          textFormat: {
            foregroundColor,
            foregroundColorStyle: {
              rgbColor: foregroundColor,
            },
          },
        },
      },
      fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat.foregroundColor,userEnteredFormat.textFormat.foregroundColorStyle',
    },
  }));

  await sheet._spreadsheet._makeBatchUpdateRequest(requests);
}

module.exports = {
  aplicarColorMontoEnFila,
};
