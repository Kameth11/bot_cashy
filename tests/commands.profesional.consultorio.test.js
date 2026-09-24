// Ítem 3.6: /profesional ahora tiene un segundo paso preguntando el
// consultorio, para que agenda.service.js pueda resolver "Consultorio N" ->
// profesional por tenant en vez de depender de CONSULTORIO_MAP hardcodeado.

jest.mock('../src/lib/telegraf', () => ({ bot: { command: jest.fn() } }));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn().mockResolvedValue('tenant-1') }));

const mockRegistrarProfesional = jest.fn();
jest.mock('../src/services/profesional.service', () => ({
  registrarProfesional: (...args) => mockRegistrarProfesional(...args),
}));

const state = require('../src/state');
const { handleProfesionalNombreStep, handleProfesionalConsultorioStep } = require('../src/handlers/commands/profesional');

beforeEach(() => {
  jest.clearAllMocks();
  state.pendingRegistros.delete(5000);
  mockRegistrarProfesional.mockResolvedValue({ ok: true });
});

test('el paso de nombre no registra todavía: pasa al paso de consultorio', async () => {
  const result = await handleProfesionalNombreStep(5000, 'Diego');

  expect(mockRegistrarProfesional).not.toHaveBeenCalled();
  expect(state.pendingRegistros.get(5000)).toEqual({ step: 'profesional_consultorio', nombre: 'Diego' });
  expect(result.message).toContain('consultorio');
});

test('el paso de consultorio registra con el consultorio escrito', async () => {
  const registro = { step: 'profesional_consultorio', nombre: 'Diego' };
  await handleProfesionalConsultorioStep(5000, 'Consultorio 2', registro);

  expect(mockRegistrarProfesional).toHaveBeenCalledWith('tenant-1', 5000, 'Diego', 'Consultorio 2');
  expect(state.pendingRegistros.has(5000)).toBe(false);
});

test('"ninguno" registra sin consultorio (null)', async () => {
  const registro = { step: 'profesional_consultorio', nombre: 'Diego' };
  await handleProfesionalConsultorioStep(5000, 'ninguno', registro);

  expect(mockRegistrarProfesional).toHaveBeenCalledWith('tenant-1', 5000, 'Diego', null);
});
