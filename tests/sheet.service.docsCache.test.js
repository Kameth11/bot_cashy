// Ítem 2.4: docsCache/invalidateCache estaban keyeados por userId, pero el
// dueño y sus invitados comparten el mismo Google Sheet. Antes de este fix,
// cada uno terminaba con su propia instancia de GoogleSpreadsheet cacheada
// para el MISMO sheetId (desperdicia la cache), y peor: invalidar desde un
// lado (ej. tras editar el sheet) no afectaba la copia cacheada del otro,
// que seguía sirviendo datos/estado viejo.

let mockLoadInfoCalls = 0;
jest.mock('../src/lib/google', () => ({
  GoogleSpreadsheet: jest.fn().mockImplementation((sheetId) => ({
    sheetId,
    loadInfo: jest.fn(async () => { mockLoadInfoCalls++; }),
    sheetsByIndex: [{ id: 'sheet0' }],
  })),
  serviceAccountAuth: {},
}));

jest.mock('../src/config', () => ({
  USE_SUPABASE: false,
  SPREADSHEET_ID: 'sheet-admin',
}));

jest.mock('../src/auth', () => ({
  esAdminOriginal: jest.fn(() => false),
  obtenerClientePorUserId: jest.fn(),
}));

const { obtenerClientePorUserId } = require('../src/auth');
const state = require('../src/state');
const { getDocCliente, invalidateCache } = require('../src/services/sheet.service');

const DUENO = 2222;
const INVITADO = 3333;
const SHEET_COMPARTIDO = 'sheet-compartido';

beforeEach(() => {
  mockLoadInfoCalls = 0;
  state.docsCache._map.clear();
  obtenerClientePorUserId.mockImplementation((userId) => {
    if (String(userId) === String(DUENO)) return { ownerId: String(DUENO), isOwner: true, sheetId: SHEET_COMPARTIDO };
    if (String(userId) === String(INVITADO)) return { ownerId: String(DUENO), isOwner: false, sheetId: SHEET_COMPARTIDO };
    return null;
  });
});

describe('getDocCliente — dueño e invitado comparten el documento cacheado', () => {
  test('el invitado reusa el doc que ya cacheó el dueño (mismo sheetId) sin volver a pedirlo', async () => {
    await getDocCliente(DUENO);
    expect(mockLoadInfoCalls).toBe(1);

    const docInvitado = await getDocCliente(INVITADO);
    expect(mockLoadInfoCalls).toBe(1); // no volvió a pedir loadInfo: reusó la cache del dueño
    expect(docInvitado.sheetId).toBe(SHEET_COMPARTIDO);
  });

  test('invalidateCache desde el invitado también limpia lo que había cacheado el dueño', async () => {
    await getDocCliente(DUENO);
    expect(mockLoadInfoCalls).toBe(1);

    invalidateCache(INVITADO);

    await getDocCliente(DUENO);
    expect(mockLoadInfoCalls).toBe(2); // se volvió a pedir: la cache compartida se limpió de verdad
  });
});
