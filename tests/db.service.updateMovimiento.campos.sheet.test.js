// Editar un movimiento (modo Sheet): ahora se puede cambiar TODO, y el signo del monto sigue al tipo.

jest.mock('../src/services/sheet.service', () => ({
  getSheetCliente: jest.fn(),
  invalidateCache: jest.fn(),
}));

const sheetService = require('../src/services/sheet.service');
const db = require('../src/services/db.service');

function fakeRow(initial) {
  const data = { ...initial };
  return {
    data,
    get: jest.fn((field) => data[field]),
    set: jest.fn((field, value) => { data[field] = value; }),
    save: jest.fn(async () => {}),
  };
}

const run = async (initial, updates) => {
  const row = fakeRow({ ID_Unico: 'm', Estado: 'Cobrado', Moneda: 'Pesos', ...initial });
  sheetService.getSheetCliente.mockResolvedValue({ getRows: async () => [row] });
  await db.updateMovimiento(1, 'm', updates);
  return row;
};

beforeEach(() => jest.clearAllMocks());

describe('campos que antes no se podían editar', () => {
  test('categoría, paciente, profesional, tratamiento y proveedor van a su columna', async () => {
    const row = await run({ Tipo: 'Ingreso', Monto: '100', MontoPesos: '100' }, {
      categoria: 'honorarios', paciente: 'Ana', profesional: 'Laura', tratamiento: 'Ortodoncia', proveedor: 'MediSupply',
    });
    expect(row.data).toMatchObject({ Categoria: 'honorarios', Paciente: 'Ana', Profesional: 'Laura', Tratamiento: 'Ortodoncia', Proveedor: 'MediSupply' });
    expect(row.save).toHaveBeenCalledTimes(1);
  });

  test('fecha, fecha de prestación y vencimiento van a su columna', async () => {
    const row = await run({ Tipo: 'Ingreso', Monto: '100', MontoPesos: '100' }, {
      fecha: '05/10/2026', fechaPrestacion: '04/10/2026', fechaVencimiento: '05/11/2026',
    });
    expect(row.data).toMatchObject({ Fecha: '05/10/2026', FechaPrestacion: '04/10/2026', FechaVencimiento: '05/11/2026' });
  });

  test('se puede vaciar un campo (categoría, vencimiento)', async () => {
    const row = await run({ Tipo: 'Ingreso', Monto: '100', MontoPesos: '100', Categoria: 'cuota', FechaVencimiento: '05/11/2026' }, { categoria: '', fechaVencimiento: '' });
    expect(row.data.Categoria).toBe('');
    expect(row.data.FechaVencimiento).toBe('');
  });

  test('una edición de solo texto no toca el monto ni el monto en pesos', async () => {
    const row = await run({ Tipo: 'Egreso', Monto: '-500', MontoPesos: '-500' }, { paciente: 'Ana' });
    expect(row.set).not.toHaveBeenCalledWith('Monto', expect.anything());
    expect(row.set).not.toHaveBeenCalledWith('MontoPesos', expect.anything());
  });
});

describe('el signo del monto sigue al tipo', () => {
  test('editar el monto de un EGRESO lo deja negativo (antes quedaba positivo)', async () => {
    const row = await run({ Tipo: 'Egreso', Monto: '-500', MontoPesos: '-500' }, { monto: 800 });
    expect(row.data.Monto).toBe(-800);
    expect(row.data.MontoPesos).toBe(-800);
  });

  test('editar el monto de un INGRESO lo deja positivo, aunque llegue negativo', async () => {
    const row = await run({ Tipo: 'Ingreso', Monto: '500', MontoPesos: '500' }, { monto: -800 });
    expect(row.data.Monto).toBe(800);
  });

  test('pasar de Ingreso a Egreso da vuelta el signo del monto y del monto en pesos', async () => {
    const row = await run({ Tipo: 'Ingreso', Monto: '500', MontoPesos: '500' }, { tipo: 'Egreso' });
    expect(row.data.Tipo).toBe('Egreso');
    expect(row.data.Monto).toBe(-500);
    expect(row.data.MontoPesos).toBe(-500);
  });

  test('pasar de Egreso a Ingreso también', async () => {
    const row = await run({ Tipo: 'Egreso', Monto: '-500', MontoPesos: '-500' }, { tipo: 'Ingreso' });
    expect(row.data.Tipo).toBe('Ingreso');
    expect(row.data.Monto).toBe(500);
    expect(row.data.MontoPesos).toBe(500);
  });

  test('cambiar el tipo Y el monto a la vez: manda el tipo nuevo', async () => {
    const row = await run({ Tipo: 'Ingreso', Monto: '500', MontoPesos: '500' }, { tipo: 'Egreso', monto: 900 });
    expect(row.data.Monto).toBe(-900);
    expect(row.data.MontoPesos).toBe(-900);
  });

  test('"cambiar" al mismo tipo no toca el signo', async () => {
    const row = await run({ Tipo: 'Egreso', Monto: '-500', MontoPesos: '-500' }, { tipo: 'Egreso' });
    expect(row.data.Monto).toBe('-500');
  });

  test('en dólares conserva la cotización original al dar vuelta el signo', async () => {
    const row = await run({ Tipo: 'Ingreso', Monto: '100', Moneda: 'Dólares', MontoPesos: '120000' }, { tipo: 'Egreso' });
    expect(row.data.Monto).toBe(-100);
    expect(row.data.MontoPesos).toBe(-120000);
  });

  test('"gasto" (el nombre viejo de egreso) se reconoce como egreso', async () => {
    const row = await run({ Tipo: 'gasto', Monto: '-500', MontoPesos: '-500' }, { monto: 700 });
    expect(row.data.Monto).toBe(-700);
  });

  test('una fila sin tipo toma el signo que ya tiene el monto', async () => {
    const neg = await run({ Monto: '-500', MontoPesos: '-500' }, { monto: 800 });
    expect(neg.data.Monto).toBe(-800);
    const pos = await run({ Monto: '500', MontoPesos: '500' }, { monto: 800 });
    expect(pos.data.Monto).toBe(800);
  });
});
