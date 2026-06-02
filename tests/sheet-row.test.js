const {
  getRowFecha,
  getRowTipo,
  getRowEstado,
  getRowMetodoPago,
  toMovimiento,
} = require('../src/utils/sheet-row');

describe('sheet-row normalization', () => {
  test('normalizes ISO date and lowercase tipo/estado from Supabase rows', () => {
    const row = {
      fecha: '2026-05-19',
      tipo: 'ingreso',
      estado: 'pendiente',
      medio_pago: 'transferencia',
      descripcion: 'Consulta',
      monto: 15000,
      moneda: 'Pesos',
    };

    expect(getRowFecha(row)).toBe('19/05/2026');
    expect(getRowTipo(row)).toBe('Ingreso');
    expect(getRowEstado(row)).toBe('Pendiente');
    expect(getRowMetodoPago(row)).toBe('transferencia');
  });

  test('toMovimiento returns normalized plain data', () => {
    const movimiento = toMovimiento({
      fecha: '2026-05-19',
      hora: '2026-05-19T14:45:00.000Z',
      descripcion: 'Alquiler',
      monto: -5000,
      estado: 'cobrado',
      tipo: 'egreso',
      moneda: 'Pesos',
      medio_pago: 'efectivo',
      pagador: 'DientesFacil',
    });

    expect(movimiento).toMatchObject({
      fecha: '19/05/2026',
      hora: '14:45',
      estado: 'Cobrado',
      tipo: 'Egreso',
      metodoPago: 'efectivo',
      pagador: 'DientesFacil',
    });
  });
});
