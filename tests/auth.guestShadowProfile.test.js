// Perfil "sombra": ensureProfile crea una fila de `profiles` para el invitado con
// el sheet del dueño. Recargada de Supabase queda como registro propio SIN
// ownerId; con ID menor al del dueño resolvía como DUEÑO con todos los permisos.

jest.mock('../src/config', () => ({ AUTHORIZED_USER_ID: 999999, ALLOWED_EMAILS: [], CODIGO_EXPIRACION_HORAS: 24 }));
jest.mock('../src/state', () => ({
  pendingIntentosEmail: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
  pendingIntentosCodigo: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
}));
let mockClientes = {};
jest.mock('../src/services/cliente.service', () => ({ get clientes() { return mockClientes; } }));

const { obtenerClientePorUserId, resolverPermisos } = require('../src/auth/index');

test('invitado con perfil sombra e ID MENOR al del dueño sigue siendo invitado', () => {
  mockClientes = {
    100: { sheetId: 'SHEET', email: null, usuarios: [], permisos: {} },
    200: { sheetId: 'SHEET', email: 'o@x.com', usuarios: [100], permisos: { 100: ['ver_agenda'] } },
  };
  const c = obtenerClientePorUserId(100);
  expect(c.isOwner).toBe(false);
  expect(String(c.ownerId)).toBe('200');
  expect(resolverPermisos(100)).toEqual(['ver_agenda']);
});

test('perfil sombra sin sheet propio también es invitado', () => {
  mockClientes = {
    100: { sheetId: null, usuarios: [] },
    200: { sheetId: 'SHEET', usuarios: [100], permisos: {} },
  };
  expect(obtenerClientePorUserId(100).isOwner).toBe(false);
});

test('un dueño real con OTRO sheet que además figura en usuarios[] de alguien sigue siendo dueño', () => {
  mockClientes = {
    100: { sheetId: 'SHEET-PROPIO', email: 'a@x.com', usuarios: [] },
    200: { sheetId: 'SHEET', usuarios: [100], permisos: {} },
  };
  expect(obtenerClientePorUserId(100).isOwner).toBe(true);
});

test('el dueño sigue resolviendo como dueño', () => {
  mockClientes = {
    100: { sheetId: 'SHEET', usuarios: [], permisos: {} },
    200: { sheetId: 'SHEET', usuarios: [100], permisos: {} },
  };
  expect(obtenerClientePorUserId(200).isOwner).toBe(true);
});
