// ensureSheetStructure se hacía en cada escritura (una llamada a la API cada
// vez). Ya verificada, no debe volver a leer los encabezados dentro del TTL.

jest.mock('../src/lib/google', () => ({ crearDocumento: jest.fn(), serviceAccountAuth: {} }));
jest.mock('../src/config', () => ({ USE_SUPABASE: false, SPREADSHEET_ID: 's', AUTHORIZED_USER_ID: 1 }));
jest.mock('../src/auth', () => ({ esAdminOriginal: jest.fn(), obtenerClientePorUserId: jest.fn() }));

const { ensureSheetStructure, REQUIRED_SHEET_HEADERS } = require('../src/services/sheet.service');

function fakeSheet(id) {
  return {
    sheetId: id,
    _spreadsheet: { spreadsheetId: 'doc-' + id },
    headerValues: [...REQUIRED_SHEET_HEADERS],
    loadHeaderRow: jest.fn(async () => {}),
  };
}

test('la segunda verificación de la misma pestaña no llama a la API', async () => {
  const sheet = fakeSheet(1);
  await ensureSheetStructure(sheet);
  await ensureSheetStructure(sheet);
  await ensureSheetStructure(sheet);
  expect(sheet.loadHeaderRow).toHaveBeenCalledTimes(1);
});

test('pestañas distintas se verifican por separado', async () => {
  const a = fakeSheet(2); const b = fakeSheet(3);
  await ensureSheetStructure(a);
  await ensureSheetStructure(b);
  expect(a.loadHeaderRow).toHaveBeenCalledTimes(1);
  expect(b.loadHeaderRow).toHaveBeenCalledTimes(1);
});
