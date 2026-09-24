// Ítem 3.6: CONSULTORIO_MAP (src/config/index.js) era un mapeo consultorio ->
// profesional hardcodeado para un solo tenant. Ahora cada profesional declara
// su consultorio al hacer /profesional, y se guarda en la tabla `profesionales`
// (columna nueva, sql/migrations/010_profesionales_consultorio.sql).

jest.mock('../src/lib/supabase', () => ({ isAvailable: jest.fn(() => true) }));

const mockEq = jest.fn();
const mockNot = jest.fn();
const mockSelect = jest.fn();
const mockUpsert = jest.fn().mockResolvedValue({ error: null });
const mockFrom = jest.fn(() => ({ upsert: mockUpsert, select: mockSelect }));
jest.mock('../src/lib/tenant-db', () => ({ forTenant: jest.fn(() => ({ from: mockFrom })) }));

const { registrarProfesional, listarConsultoriosAsignados } = require('../src/services/profesional.service');

beforeEach(() => {
  jest.clearAllMocks();
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ not: mockNot });
});

test('registrarProfesional guarda el consultorio declarado', async () => {
  await registrarProfesional('tenant-1', 111, 'Diego', 'Consultorio 2');

  expect(mockUpsert).toHaveBeenCalledWith(
    { telegram_user_id: '111', nombre: 'Diego', consultorio: 'Consultorio 2', activo: true },
    { onConflict: 'telegram_user_id' }
  );
});

test('registrarProfesional guarda consultorio null cuando no se declara ninguno', async () => {
  await registrarProfesional('tenant-1', 111, 'Diego');

  expect(mockUpsert).toHaveBeenCalledWith(
    expect.objectContaining({ consultorio: null }),
    expect.anything()
  );
});

test('listarConsultoriosAsignados devuelve solo profesionales activos con consultorio cargado', async () => {
  mockNot.mockResolvedValue({ data: [{ nombre: 'Diego', consultorio: 'Consultorio 2' }] });

  const filas = await listarConsultoriosAsignados('tenant-1');

  expect(mockFrom).toHaveBeenCalledWith('profesionales');
  expect(mockEq).toHaveBeenCalledWith('activo', true);
  expect(mockNot).toHaveBeenCalledWith('consultorio', 'is', null);
  expect(filas).toEqual([{ nombre: 'Diego', consultorio: 'Consultorio 2' }]);
});

test('listarConsultoriosAsignados devuelve [] sin Supabase o sin tenantId', async () => {
  const { isAvailable } = require('../src/lib/supabase');
  isAvailable.mockReturnValueOnce(false);
  expect(await listarConsultoriosAsignados('tenant-1')).toEqual([]);
  expect(await listarConsultoriosAsignados(null)).toEqual([]);
});
