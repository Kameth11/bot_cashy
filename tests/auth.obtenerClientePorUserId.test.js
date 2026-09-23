// Ítem 2.1: obtenerClientePorUserId recorría Object.entries(clientes), que
// para claves con forma de índice (todos los IDs de Telegram lo son) itera
// en orden numérico ascendente, NO en orden de inserción. Un invitado dado
// de alta bajo el modelo viejo (antes de este fix) tenía DOS registros: el
// suyo propio (con su propio sheet, ownerId apuntando al dueño real) y su
// membresía en usuarios[] del dueño. Cuál ganaba dependía de si el ID de
// Telegram del invitado era mayor o menor que el del dueño — probado en la
// revisión con 1419810344 (dueño) + 8321573327 (invitado) en los dos
// órdenes. Ahora la resolución es determinística: si el propio registro
// declara `ownerId`, gana siempre, sin importar el orden de las claves.

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 999999,
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
}));

jest.mock('../src/state', () => ({
  pendingIntentosEmail: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
  pendingIntentosCodigo: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
}));

let mockClientesFixture = {};
jest.mock('../src/services/cliente.service', () => ({
  get clientes() { return mockClientesFixture; },
}));

const { obtenerClientePorUserId } = require('../src/auth/index');

beforeEach(() => {
  mockClientesFixture = {};
});

describe('obtenerClientePorUserId — resolución determinística de invitados', () => {
  test('invitado con ID NUMÉRICAMENTE MAYOR que el dueño (legacy: registro propio + ownerId + usuarios[])', () => {
    const DUENO = 1419810344;
    const INVITADO = 8321573327; // > DUENO

    mockClientesFixture[DUENO] = { sheetId: 'sheet-dueno', usuarios: [INVITADO], permisos: {} };
    mockClientesFixture[INVITADO] = { sheetId: 'sheet-propio-legacy', ownerId: DUENO, usuarios: [] };

    const resuelto = obtenerClientePorUserId(INVITADO);

    expect(resuelto.isOwner).toBe(false);
    expect(resuelto.ownerId).toBe(String(DUENO));
    expect(resuelto.sheetId).toBe('sheet-dueno');
  });

  test('invitado con ID NUMÉRICAMENTE MENOR que el dueño — antes resolvía como dueño de su propio sheet con permisos completos', () => {
    const DUENO = 8321573327;
    const INVITADO = 1419810344; // < DUENO

    mockClientesFixture[DUENO] = { sheetId: 'sheet-dueno', usuarios: [INVITADO], permisos: {} };
    mockClientesFixture[INVITADO] = { sheetId: 'sheet-propio-legacy', ownerId: DUENO, usuarios: [] };

    const resuelto = obtenerClientePorUserId(INVITADO);

    // Antes del fix esto daba isOwner: true (con ADMIN_PERMISOS) sobre
    // 'sheet-propio-legacy', ignorando los permisos que el dueño real
    // configuró en /accesos.
    expect(resuelto.isOwner).toBe(false);
    expect(resuelto.ownerId).toBe(String(DUENO));
    expect(resuelto.sheetId).toBe('sheet-dueno');
  });

  test('el dueño real (sin ownerId propio) sigue resolviendo como isOwner: true', () => {
    const DUENO = 5000;
    mockClientesFixture[DUENO] = { sheetId: 'sheet-dueno', usuarios: [], permisos: {} };

    const resuelto = obtenerClientePorUserId(DUENO);

    expect(resuelto.isOwner).toBe(true);
    expect(resuelto.sheetId).toBe('sheet-dueno');
  });

  test('invitado moderno (solo en usuarios[], sin registro propio) resuelve igual sin importar el orden de IDs', () => {
    const DUENO_ID_ALTO = 9000000000;
    const INVITADO_ID_BAJO = 100;
    mockClientesFixture[DUENO_ID_ALTO] = { sheetId: 'sheet-dueno', usuarios: [INVITADO_ID_BAJO], permisos: {} };

    const resuelto = obtenerClientePorUserId(INVITADO_ID_BAJO);

    expect(resuelto.isOwner).toBe(false);
    expect(resuelto.sheetId).toBe('sheet-dueno');
  });

  test('si el ownerId de un registro propio ya no existe, cae al comportamiento anterior (no revienta)', () => {
    const INVITADO = 4242;
    mockClientesFixture[INVITADO] = { sheetId: 'sheet-huerfano', ownerId: 999, usuarios: [] };

    const resuelto = obtenerClientePorUserId(INVITADO);

    expect(resuelto.isOwner).toBe(true);
    expect(resuelto.sheetId).toBe('sheet-huerfano');
  });

  test('usuario desconocido → null', () => {
    expect(obtenerClientePorUserId(123456)).toBeNull();
  });
});
