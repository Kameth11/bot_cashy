// USE_SUPABASE=false (default de test, ver setup-env.js): updateMovimiento
// usa el path de Sheets puro (getSheetService().getSheetCliente -> getRows()),
// que alcanza para probar la lógica de stamping de FechaCobro sin Supabase.

jest.mock('../src/services/sheet.service', () => ({
  getSheetCliente: jest.fn(),
  invalidateCache: jest.fn(),
}));

const sheetService = require('../src/services/sheet.service');
const db = require('../src/services/db.service');

// Fila falsa con la misma interfaz get/set/save que usa una fila real de
// google-spreadsheet.
function fakeRow(initial) {
  const data = { ...initial };
  return {
    get: jest.fn((field) => data[field]),
    set: jest.fn((field, value) => { data[field] = value; }),
    save: jest.fn(async () => {}),
  };
}

describe('updateMovimiento - stamping de FechaCobro', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Pendiente -> Cobrado: stampea FechaCobro con la fecha de hoy', async () => {
    const row = fakeRow({ Estado: 'Pendiente', ID_Unico: 'mov1' });
    sheetService.getSheetCliente.mockResolvedValue({ getRows: async () => [row] });

    const hoy = new Date();
    const hoyStr = `${hoy.getDate().toString().padStart(2, '0')}/${(hoy.getMonth() + 1).toString().padStart(2, '0')}/${hoy.getFullYear()}`;

    await db.updateMovimiento(1, 'mov1', { estado: 'Cobrado' });

    expect(row.set).toHaveBeenCalledWith('Estado', 'Cobrado');
    expect(row.set).toHaveBeenCalledWith('FechaCobro', hoyStr);
  });

  test('Cobrado -> Pendiente: limpia FechaCobro', async () => {
    const row = fakeRow({ Estado: 'Cobrado', FechaCobro: '01/01/2026', ID_Unico: 'mov1' });
    sheetService.getSheetCliente.mockResolvedValue({ getRows: async () => [row] });

    await db.updateMovimiento(1, 'mov1', { estado: 'Pendiente' });

    expect(row.set).toHaveBeenCalledWith('Estado', 'Pendiente');
    expect(row.set).toHaveBeenCalledWith('FechaCobro', '');
  });

  test('otras ediciones (sin cambio de estado) no tocan FechaCobro', async () => {
    const row = fakeRow({ Estado: 'Cobrado', FechaCobro: '01/01/2026', ID_Unico: 'mov1' });
    sheetService.getSheetCliente.mockResolvedValue({ getRows: async () => [row] });

    await db.updateMovimiento(1, 'mov1', { descripcion: 'Nueva descripción' });

    expect(row.set).not.toHaveBeenCalledWith('FechaCobro', expect.anything());
  });

  test('re-guardar el mismo estado Cobrado no vuelve a stampear', async () => {
    const row = fakeRow({ Estado: 'Cobrado', FechaCobro: '01/01/2026', ID_Unico: 'mov1' });
    sheetService.getSheetCliente.mockResolvedValue({ getRows: async () => [row] });

    await db.updateMovimiento(1, 'mov1', { estado: 'Cobrado' });

    expect(row.set).not.toHaveBeenCalledWith('FechaCobro', expect.anything());
  });
});

describe('updateMovimiento - recálculo de MontoPesos', () => {
  beforeEach(() => jest.clearAllMocks());

  const run = async (initial, updates) => {
    const row = fakeRow({ ID_Unico: 'm', Estado: 'Cobrado', ...initial });
    sheetService.getSheetCliente.mockResolvedValue({ getRows: async () => [row] });
    await db.updateMovimiento(1, 'm', updates);
    return row;
  };

  test('mismo tipo de moneda: conserva la cotización original', async () => {
    const row = await run({ Monto: '100', Moneda: 'Dólares', MontoPesos: '120000' }, { monto: 50 });
    expect(row.set).toHaveBeenCalledWith('MontoPesos', 60000);
  });

  test('pesos: MontoPesos = monto, con signo', async () => {
    const row = await run({ Monto: '-500', Moneda: 'Pesos', MontoPesos: '-500' }, { monto: -800 });
    expect(row.set).toHaveBeenCalledWith('MontoPesos', -800);
  });

  test('cambio de moneda a dólares: usa la cotización actual', async () => {
    const row = await run({ Monto: '100', Moneda: 'Pesos', MontoPesos: '100' }, { moneda: 'Dólares' });
    expect(row.set).toHaveBeenCalledWith('MontoPesos', 100 * 1200); // COTIZACION_DEFAULT de setup-env
  });

  test('editar solo el estado no toca MontoPesos', async () => {
    const row = await run({ Monto: '100', Moneda: 'Pesos', MontoPesos: '100' }, { estado: 'Pendiente' });
    expect(row.set).not.toHaveBeenCalledWith('MontoPesos', expect.anything());
  });
});
