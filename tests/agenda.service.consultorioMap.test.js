// Ítem 3.6: CONSULTORIO_MAP era el único origen posible para resolver
// "Consultorio N" -> profesional al leer una agenda por foto (hardcodeado
// para un solo tenant). Ahora obtenerConsultorioMap() usa lo que cada
// profesional del tenant declaró (tabla `profesionales`, columna
// `consultorio`), con CONSULTORIO_MAP como fallback si el tenant no tiene
// Supabase o todavía no cargó nada (compatibilidad con el tenant existente).

jest.mock('../src/config', () => ({
  CONSULTORIO_MAP: { 'consultorio 1': 'Laura', 'consultorio 2': 'Diego' },
}));

const mockListarConsultoriosAsignados = jest.fn();
jest.mock('../src/services/profesional.service', () => ({
  listarConsultoriosAsignados: (...args) => mockListarConsultoriosAsignados(...args),
}));

jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn() }));
jest.mock('../src/lib/write-queue', () => ({ runInBackground: jest.fn() }));

const { obtenerConsultorioMap, resolverProfesional } = require('../src/services/agenda.service');

beforeEach(() => jest.clearAllMocks());

describe('obtenerConsultorioMap', () => {
  test('sin tenantId, devuelve CONSULTORIO_MAP (deploy sin Supabase)', async () => {
    const mapa = await obtenerConsultorioMap(null);
    expect(mapa).toEqual({ 'consultorio 1': 'Laura', 'consultorio 2': 'Diego' });
    expect(mockListarConsultoriosAsignados).not.toHaveBeenCalled();
  });

  test('si el tenant no cargó ningún consultorio, cae a CONSULTORIO_MAP', async () => {
    mockListarConsultoriosAsignados.mockResolvedValue([]);
    const mapa = await obtenerConsultorioMap('tenant-nuevo');
    expect(mapa).toEqual({ 'consultorio 1': 'Laura', 'consultorio 2': 'Diego' });
  });

  test('si el tenant tiene profesionales con consultorio, arma su propio mapa (reemplaza el default)', async () => {
    mockListarConsultoriosAsignados.mockResolvedValue([
      { nombre: 'Ana', consultorio: 'Consultorio 5' },
    ]);
    const mapa = await obtenerConsultorioMap('tenant-propio');
    expect(mapa).toEqual({ 'consultorio 5': 'Ana' });
  });

  test('cachea el resultado por tenant (no vuelve a consultar Supabase en la segunda llamada)', async () => {
    mockListarConsultoriosAsignados.mockResolvedValue([{ nombre: 'Ana', consultorio: 'Consultorio 5' }]);
    await obtenerConsultorioMap('tenant-cache');
    await obtenerConsultorioMap('tenant-cache');
    expect(mockListarConsultoriosAsignados).toHaveBeenCalledTimes(1);
  });
});

describe('resolverProfesional con un mapa explícito', () => {
  test('usa el mapa pasado, no CONSULTORIO_MAP, cuando se le da uno', () => {
    const mapaTenant = { 'consultorio 5': 'Ana' };
    expect(resolverProfesional(null, 'Consultorio 5', mapaTenant)).toBe('Ana');
    // Un consultorio que existe en CONSULTORIO_MAP pero no en el mapa del tenant no matchea.
    expect(resolverProfesional(null, 'Consultorio 1', mapaTenant)).toBe('');
  });

  test('sin mapa explícito, sigue usando CONSULTORIO_MAP (compatibilidad)', () => {
    expect(resolverProfesional(null, 'Consultorio 1')).toBe('Laura');
  });
});
