jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: jest.fn() } } }));
const mockCrearDocumento = jest.fn();
jest.mock('../src/lib/google', () => ({ crearDocumento: (...a) => mockCrearDocumento(...a), serviceAccountAuth: {} }));
jest.mock('../src/services/sheet.service', () => ({ ensureSheetStructure: jest.fn() }));

const state = require('../src/state');
const clienteService = require('../src/services/cliente.service');
const { handlePendingRegistration } = require('../src/services/registration.service');

const SHEET_AJENO = 'sheet_ajeno_de_otro_consultorio_1234567890abcdef';

test('registrar el sheet de otro consultorio se rechaza sin tocar Google ni guardar nada', async () => {
  clienteService.clientes = { 111: { sheetId: SHEET_AJENO, usuarios: [] } };
  const guardar = jest.spyOn(clienteService, 'guardarClientes').mockResolvedValue();
  state.pendingRegistros.set(222, { step: 'sheetId', email: 'nuevo@x.com', telegramUserId: 222 });

  const res = await handlePendingRegistration(222, SHEET_AJENO);

  expect(res.message).toMatch(/ya está en uso/);
  expect(mockCrearDocumento).not.toHaveBeenCalled();
  expect(guardar).not.toHaveBeenCalled();
  expect(clienteService.clientes[222]).toBeUndefined();
});
