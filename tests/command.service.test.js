jest.mock('../src/services/sheet.service', () => ({
  obtenerDatosSheet: jest.fn(),
  getSheetCliente: jest.fn(),
  invalidateCache: jest.fn(),
}));

jest.mock('../src/services/db.service', () => ({
  getRows: jest.fn(),
  addRow: jest.fn(),
}));

jest.mock('../src/services/sheet-format.service', () => ({
  aplicarColorMontoEnFila: jest.fn(),
}));

jest.mock('../src/services/cotizacion.service', () => ({
  obtenerCotizacionDolar: jest.fn(async () => 1200),
}));

jest.mock('../src/services/movimiento.service', () => ({
  calcularMontoPesos: jest.fn((monto, moneda, cotizacionUsada = 1200) => (
    moneda === 'Dólares' ? Math.abs(monto) * cotizacionUsada : monto
  )),
  crearMensajeMovimientoRegistrado: jest.fn(({ descripcion, estado }) => `mock:${descripcion}:${estado}`),
  guardarMovimiento: jest.fn(async (userId, payload) => ({
    rowData: payload,
    idUnico: 'mov_test_123',
    fechaStr: '17/05/2026',
  })),
}));

const state = require('../src/state');
const commandService = require('../src/services/command.service');
const movimientoService = require('../src/services/movimiento.service');

describe('registrarMovimientoDesdeNLP', () => {
  beforeEach(() => {
    state.pendingDescripcion.clear();
    state.pendingCotizaciones.clear();
    state.pendingPayments.clear();
    state.cotizacionDolar = 1200;
    jest.clearAllMocks();
  });

  test('pide monto cuando falta', async () => {
    const result = await commandService.registrarMovimientoDesdeNLP(101, {
      tipo: 'ingreso',
      descripcion: 'Juan Perez',
      monto: null,
      moneda: 'Pesos',
    });

    expect(result).toEqual({
      necesitaInfo: true,
      campo: 'monto',
      mensaje: '💰 ¿De cuánto es el movimiento? Ingresá el monto:',
    });
  });

  test('pide descripción y guarda contexto pendiente', async () => {
    const result = await commandService.registrarMovimientoDesdeNLP(102, {
      tipo: 'consulta',
      descripcion: null,
      monto: 15000,
      moneda: 'Pesos',
      metodo_pago: 'efectivo',
      pacienteNombre: 'Juan Perez',
    });

    expect(result).toEqual({
      necesitaInfo: true,
      campo: 'descripcion',
      mensaje: '📝 ¿De quién o qué concepto es el movimiento?',
    });

    expect(state.pendingDescripcion.get(102)).toMatchObject({
      tipo: 'consulta',
      monto: 15000,
      moneda: 'Pesos',
      metodo_pago: 'efectivo',
      categoria: 'consulta',
      pacienteNombre: 'Juan Perez',
      tratamientoNombre: 'Consulta',
    });
  });

  test('completa tratamiento Consulta por defecto al persistir una consulta', async () => {
    const result = await commandService.registrarMovimientoDesdeNLP(108, {
      tipo: 'consulta',
      descripcion: 'Diego',
      monto: 15000,
      moneda: 'Pesos',
      metodo_pago: 'efectivo',
      categoria: 'consulta',
      pacienteNombre: 'Diego',
    });

    expect(result).toMatchObject({
      success: true,
      idUnico: 'mov_test_123',
      mensaje: 'mock:Diego:Cobrado',
    });
    expect(movimientoService.guardarMovimiento).toHaveBeenCalledWith(108, expect.objectContaining({
      descripcion: 'Diego',
      categoria: 'consulta',
      pacienteNombre: 'Diego',
      tratamientoNombre: 'Consulta',
    }));
  });

  test('pide cotización para movimientos en dólares', async () => {
    const result = await commandService.registrarMovimientoDesdeNLP(103, {
      tipo: 'servicio',
      descripcion: 'Endodoncia',
      monto: 50,
      moneda: 'Dólares',
      metodo_pago: 'transferencia',
      tratamientoNombre: 'Endodoncia',
    });

    expect(result.necesitaInfo).toBe(true);
    expect(result.campo).toBe('cotizacion');
    expect(result.mensaje).toContain('Movimiento en dólares');
    expect(state.pendingCotizaciones.get(103)).toMatchObject({
      comando: 'consulta',
      descripcion: 'Endodoncia',
      monto: 50,
      tipo: 'Ingreso',
      moneda: 'Dólares',
      metodoIndicado: 'transferencia',
      tratamientoNombre: 'Endodoncia',
    });
  });

  test('pide método de pago si el ingreso cobrado no lo trae', async () => {
    const result = await commandService.registrarMovimientoDesdeNLP(104, {
      tipo: 'ingreso',
      descripcion: 'Juan Perez',
      monto: 15000,
      moneda: 'Pesos',
      estado: 'Cobrado',
      pacienteNombre: 'Juan Perez',
    });

    expect(result).toMatchObject({
      necesitaInfo: true,
      campo: 'metodo_pago',
    });
    expect(state.pendingPayments.get(104)).toMatchObject({
      descripcion: 'Juan Perez',
      monto: 15000,
      tipo: 'Ingreso',
      moneda: 'Pesos',
      estado: 'Cobrado',
      pacienteNombre: 'Juan Perez',
    });
  });

  test('persiste pendiente sin pedir método de pago', async () => {
    const result = await commandService.registrarMovimientoDesdeNLP(105, {
      tipo: 'ingreso',
      descripcion: 'Marta',
      monto: 30000,
      moneda: 'Pesos',
      estado: 'Pendiente',
      categoria: 'cobro_pendiente',
      pacienteNombre: 'Marta',
    });

    expect(result).toMatchObject({
      success: true,
      idUnico: 'mov_test_123',
      mensaje: 'mock:Marta:Pendiente',
    });
    expect(movimientoService.guardarMovimiento).toHaveBeenCalledWith(105, expect.objectContaining({
      descripcion: 'Marta',
      monto: 30000,
      tipo: 'Ingreso',
      moneda: 'Pesos',
      metodoPago: undefined,
      estado: 'Pendiente',
      categoria: 'cobro_pendiente',
      pacienteNombre: 'Marta',
    }));
  });

  test('persiste pagador separado cuando el NLP lo trae', async () => {
    const result = await commandService.registrarMovimientoDesdeNLP(107, {
      tipo: 'ingreso',
      descripcion: 'Laura',
      monto: 400000,
      moneda: 'Pesos',
      metodo_pago: 'efectivo',
      pacienteNombre: 'Laura',
      pagadorNombre: 'DientesFacil',
    });

    expect(result).toMatchObject({
      success: true,
      idUnico: 'mov_test_123',
      mensaje: 'mock:Laura:Cobrado',
    });
    expect(movimientoService.guardarMovimiento).toHaveBeenCalledWith(107, expect.objectContaining({
      descripcion: 'Laura',
      pacienteNombre: 'Laura',
      pagadorNombre: 'DientesFacil',
      notas: 'Pagador: DientesFacil',
    }));
  });

  test('normaliza egreso positivo a monto negativo al persistir', async () => {
    const result = await commandService.registrarMovimientoDesdeNLP(106, {
      tipo: 'gasto',
      descripcion: 'Alquiler',
      monto: 5000,
      moneda: 'Pesos',
      metodo_pago: 'transferencia',
    });

    expect(result).toMatchObject({
      success: true,
      idUnico: 'mov_test_123',
      mensaje: 'mock:Alquiler:Cobrado',
    });
    expect(movimientoService.guardarMovimiento).toHaveBeenCalledWith(106, expect.objectContaining({
      descripcion: 'Alquiler',
      monto: -5000,
      tipo: 'Egreso',
      moneda: 'Pesos',
      metodoPago: 'transferencia',
      estado: 'Cobrado',
      categoria: 'alquiler',
    }));
  });
});
