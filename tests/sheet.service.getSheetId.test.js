// Bug: un invitado bajo la cuenta admin (owner sin sheetId propio guardado,
// solo vive del fallback a SPREADSHEET_ID) resolvía a sheetId null, porque
// el fallback chequeaba esAdminOriginal(userId) sobre quien pide el dato
// (el invitado) en vez de sobre el dueño ya resuelto (cliente.ownerId).
// Consecuencia real: sus movimientos nuevos se guardaban en un tenant
// distinto al del admin (ver ensureProfile en db.service.js), como si el
// sheet estuviera "en blanco" para el invitado.

jest.mock('../src/config', () => ({
  USE_SUPABASE: false,
  SPREADSHEET_ID: 'sheet-admin-fallback',
}));

const ADMIN_ID = 1111;
const GUEST_ID = 2222;
const OWNER_CON_SHEET_ID = 3333;
const OWNER_CON_SHEET_SHEETID = 'sheet-propio-del-dueno';

jest.mock('../src/auth', () => ({
  esAdminOriginal: jest.fn((userId) => Number(userId) === ADMIN_ID),
  obtenerClientePorUserId: jest.fn((userId) => {
    const id = Number(userId);
    if (id === ADMIN_ID) return { ownerId: ADMIN_ID, isOwner: true }; // admin: sin sheetId propio
    if (id === GUEST_ID) return { ownerId: ADMIN_ID, isOwner: false }; // invitado del admin
    if (id === OWNER_CON_SHEET_ID) return { ownerId: OWNER_CON_SHEET_ID, isOwner: true, sheetId: OWNER_CON_SHEET_SHEETID };
    return null;
  }),
}));

const { getSheetId } = require('../src/services/sheet.service');

describe('getSheetId — fallback a SPREADSHEET_ID cuando el owner resuelto es el admin', () => {
  test('el admin mismo cae al fallback (comportamiento previo, sigue igual)', () => {
    expect(getSheetId(ADMIN_ID)).toBe('sheet-admin-fallback');
  });

  test('[bug fijo] un invitado del admin también cae al fallback, no a null', () => {
    expect(getSheetId(GUEST_ID)).toBe('sheet-admin-fallback');
  });

  test('un dueño con sheetId propio nunca usa el fallback (sin cambios)', () => {
    expect(getSheetId(OWNER_CON_SHEET_ID)).toBe(OWNER_CON_SHEET_SHEETID);
  });

  test('un userId totalmente desconocido (no admin, sin cliente) da null', () => {
    expect(getSheetId(9999)).toBeNull();
  });
});
