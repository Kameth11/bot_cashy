// Ítem 6 de la auditoría: un sheet pertenece a un solo consultorio.

jest.mock('../src/config', () => ({ USE_SUPABASE: false, CLIENTES_FILE: '/tmp/clientes_sheetid_test.json' }));
const clienteService = require('../src/services/cliente.service');

beforeEach(() => {
  clienteService.clientes = {
    100: { sheetId: 'SHEET-A', usuarios: [300] },
    300: { sheetId: 'SHEET-A', usuarios: [] },            // perfil sombra de un invitado de 100
    200: { sheetId: 'SHEET-B', usuarios: [] },
  };
});

test('sheet de otro consultorio: en uso', () => {
  expect(clienteService.sheetIdEnUsoPorOtro('SHEET-A', 200)).toBe(true);
  expect(clienteService.sheetIdEnUsoPorOtro('SHEET-B', 100)).toBe(true);
});

test('sheet propio (re-registro): no está en uso por otro, ni por sus propios invitados', () => {
  expect(clienteService.sheetIdEnUsoPorOtro('SHEET-A', 100)).toBe(false);
  expect(clienteService.sheetIdEnUsoPorOtro('SHEET-B', 200)).toBe(false);
});

test('sheet nuevo: libre', () => {
  expect(clienteService.sheetIdEnUsoPorOtro('SHEET-NUEVO', 200)).toBe(false);
});
