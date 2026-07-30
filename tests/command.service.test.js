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
const sheetService = require('../src/services/sheet.service');

describe('reportes de gestión v2', () => {
  const hoy = new Date();
  const fechaHoy = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockDatos(datos) {
    sheetService.obtenerDatosSheet.mockResolvedValue(datos);
  }

  test('ejecutarCobrosPorMetodo agrupa ingresos cobrados del mes por método', async () => {
    mockDatos([
      { fecha: fechaHoy, tipo: 'Ingreso', estado: 'Cobrado', metodoPago: 'efectivo', montoPesos: 10000 },
      { fecha: fechaHoy, tipo: 'Ingreso', estado: 'Cobrado', metodoPago: 'efectivo', montoPesos: 5000 },
      { fecha: fechaHoy, tipo: 'Ingreso', estado: 'Cobrado', metodoPago: 'transferencia', montoPesos: 5000 },
      { fecha: fechaHoy, tipo: 'Ingreso', estado: 'Pendiente', metodoPago: '', montoPesos: 9999 },
      { fecha: fechaHoy, tipo: 'Egreso', estado: 'Cobrado', metodoPago: 'efectivo', montoPesos: -1000 },
    ]);

    const msg = await commandService.ejecutarCobrosPorMetodo(1);
    expect(msg).toContain('efectivo');
    expect(msg).toContain('75%');
    expect(msg).toContain('transferencia');
    expect(msg).toContain('Total cobrado: $20.000');
    expect(msg).not.toContain('9.999');
  });

  test('ejecutarCobrosPorMetodo sin datos devuelve mensaje vacío', async () => {
    mockDatos([]);
    expect(await commandService.ejecutarCobrosPorMetodo(1)).toContain('No hay ingresos cobrados');
  });

  test('ejecutarDeudores agrupa ingresos pendientes por paciente', async () => {
    mockDatos([
      { fecha: fechaHoy, tipo: 'Ingreso', estado: 'Pendiente', paciente: 'Juan', montoPesos: 30000, fechaVencimiento: '01/07/2026' },
      { fecha: fechaHoy, tipo: 'Ingreso', estado: 'Pendiente', paciente: 'Juan', montoPesos: 10000 },
      { fecha: fechaHoy, tipo: 'Ingreso', estado: 'Cobrado', paciente: 'Marta', montoPesos: 5000 },
    ]);

    const msg = await commandService.ejecutarDeudores(1);
    expect(msg).toContain('Juan');
    expect(msg).toContain('$40.000');
    expect(msg).toContain('2 pendientes');
    expect(msg).toContain('vence 01/07/2026');
    expect(msg).not.toContain('Marta');
  });

  test('ejecutarDeudores sin pendientes', async () => {
    mockDatos([{ fecha: fechaHoy, tipo: 'Ingreso', estado: 'Cobrado', montoPesos: 1000 }]);
    expect(await commandService.ejecutarDeudores(1)).toContain('No hay deudores');
  });

  test('ejecutarEgresosCategoria agrupa egresos del mes por categoría', async () => {
    mockDatos([
      { fecha: fechaHoy, tipo: 'Egreso', categoria: 'insumos', montoPesos: -8000 },
      { fecha: fechaHoy, tipo: 'Egreso', categoria: 'insumos', montoPesos: -2000 },
      { fecha: fechaHoy, tipo: 'Egreso', categoria: '', montoPesos: -10000 },
      { fecha: fechaHoy, tipo: 'Ingreso', categoria: 'consulta', montoPesos: 5000 },
    ]);

    const msg = await commandService.ejecutarEgresosCategoria(1);
    expect(msg).toContain('insumos');
    expect(msg).toContain('sin categoría');
    expect(msg).toContain('Total egresos: $20.000');
  });

  test('ejecutarPorProfesional separa cobrado y pendiente por profesional', async () => {
    mockDatos([
      { fecha: fechaHoy, tipo: 'Ingreso', estado: 'Cobrado', profesional: 'Dra Lopez', montoPesos: 20000 },
      { fecha: fechaHoy, tipo: 'Ingreso', estado: 'Pendiente', profesional: 'Dra Lopez', montoPesos: 5000 },
      { fecha: fechaHoy, tipo: 'Ingreso', estado: 'Cobrado', profesional: '', montoPesos: 1000 },
    ]);

    const msg = await commandService.ejecutarPorProfesional(1);
    expect(msg).toContain('Dra Lopez');
    expect(msg).toContain('cobrado $20.000');
    expect(msg).toContain('pendiente $5.000');
    expect(msg).toContain('Sin profesional');
    expect(msg).toContain('Total cobrado: $21.000');
  });
});

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

describe('ejecutarCobrar - stamping de FechaCobro', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Fila falsa con la misma interfaz get/set/save que usan los wrappers
  // reales (Sheet row o Supabase row): suficiente para probar la lógica de
  // doEjecutarCobrar sin tocar Sheets/Supabase de verdad.
  function fakeRow(initial) {
    const data = { ...initial };
    return {
      get: jest.fn((field) => data[field]),
      set: jest.fn((field, value) => { data[field] = value; }),
      save: jest.fn(async () => {}),
      _data: data,
    };
  }

  const dbService = require('../src/services/db.service');

  test('cobro total: stampea FechaCobro con la fecha de hoy', async () => {
    const row = fakeRow({ Estado: 'Pendiente', Descripcion: 'Consulta Juan', Monto: 5000, Moneda: 'Pesos', ID_Unico: 'mov1' });
    dbService.getRows.mockResolvedValue([row]);

    const hoy = new Date();
    const hoyStr = `${hoy.getDate().toString().padStart(2, '0')}/${(hoy.getMonth() + 1).toString().padStart(2, '0')}/${hoy.getFullYear()}`;

    await commandService.ejecutarCobrar(1, 'ultimo');

    expect(row.set).toHaveBeenCalledWith('Estado', 'Cobrado');
    expect(row.set).toHaveBeenCalledWith('FechaCobro', hoyStr);
    expect(row.save).toHaveBeenCalledTimes(1);
  });

  test('cobro parcial: NO stampea FechaCobro (sigue Pendiente)', async () => {
    const row = fakeRow({ Estado: 'Pendiente', Descripcion: 'Consulta Juan', Monto: 5000, Moneda: 'Pesos', ID_Unico: 'mov1' });
    dbService.getRows.mockResolvedValue([row]);

    await commandService.ejecutarCobrar(1, 'Juan 2000');

    expect(row.set).toHaveBeenCalledWith('Estado', 'Pendiente');
    expect(row.set).not.toHaveBeenCalledWith('FechaCobro', expect.anything());
  });
});
