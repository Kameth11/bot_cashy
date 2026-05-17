const { quickParse } = require('../src/services/quick_nlp.service');

describe('quickParse', () => {
  test('parsea consulta clínica simple en pesos', () => {
    const result = quickParse('consulta Juan Perez $15000 efectivo');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        descripcion: 'Juan Perez',
        monto: 15000,
        moneda: 'Pesos',
        metodo_pago: 'efectivo',
        categoria: 'consulta',
        pacienteNombre: 'Juan Perez',
        profesionalNombre: null,
        tratamientoNombre: null,
      },
    });
  });

  test('parsea servicio en dólares con tratamiento', () => {
    const result = quickParse('servicio endodoncia U$50 transferencia');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        descripcion: 'Endodoncia',
        monto: 50,
        moneda: 'Dólares',
        metodo_pago: 'transferencia',
        categoria: 'tratamiento',
        tratamientoNombre: 'Endodoncia',
      },
    });
  });

  test('parsea anticipo con paciente, tratamiento y profesional', () => {
    const result = quickParse('anticipo Juan Perez implante Dra Lopez 50k transferencia');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        monto: 50000,
        moneda: 'Pesos',
        metodo_pago: 'transferencia',
        categoria: 'anticipo',
        pacienteNombre: 'Juan Perez',
        profesionalNombre: 'Dra Lopez',
        tratamientoNombre: 'Implante',
      },
    });
  });

  test('parsea cobro explícito como ingreso nuevo cuando trae monto', () => {
    const result = quickParse('me pagaron 20 lucas de Marta');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        monto: 20000,
        moneda: 'Pesos',
        pacienteNombre: 'Marta',
      },
    });
  });

  test('parsea pago sin monto como cobro de pendiente', () => {
    expect(quickParse('me pagó Juan')).toEqual({
      intent: 'cobrar_movimiento',
      entities: { nombre: 'juan' },
    });
  });

  test('parsea transferencia sin monto como cobro de pendiente', () => {
    expect(quickParse('Juan me transfirió')).toEqual({
      intent: 'cobrar_movimiento',
      entities: { nombre: 'juan' },
    });
  });

  test('parsea ingreso pendiente con paciente y monto', () => {
    const result = quickParse('pendiente Juan Perez $15000');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        descripcion: 'Juan Perez',
        monto: 15000,
        estado: 'Pendiente',
        categoria: 'cobro_pendiente',
        pacienteNombre: 'Juan Perez',
      },
    });
  });

  test('parsea deuda redactada nombre primero', () => {
    const result = quickParse('Marta me debe 30k');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        descripcion: 'Marta',
        monto: 30000,
        estado: 'Pendiente',
        categoria: 'cobro_pendiente',
      },
    });
  });

  test('parsea egreso con proveedor y categoría', () => {
    const result = quickParse('pagué a Dental Sur 80k por guantes');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'gasto',
        monto: 80000,
        categoria: 'insumos',
        proveedorNombre: 'Dental Sur',
      },
    });
  });

  test('parsea egreso simple por alquiler', () => {
    const result = quickParse('gasté 5000 en alquiler');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'gasto',
        descripcion: 'Alquiler',
        monto: 5000,
        categoria: 'alquiler',
      },
    });
  });

  test('parsea intención de balance', () => {
    expect(quickParse('cuánto tengo')).toEqual({
      intent: 'ver_balance',
      entities: {},
    });
  });

  test('parsea intención de pendientes', () => {
    expect(quickParse('ver pendientes')).toEqual({
      intent: 'ver_pendientes',
      entities: {},
    });
  });

  test('parsea eliminación por texto libre', () => {
    expect(quickParse('borrar gasto insumos')).toEqual({
      intent: 'eliminar_movimiento',
      entities: { nombre: 'gasto insumos' },
    });
  });

  test('parsea seña como ingreso clínico', () => {
    const result = quickParse('seña Ana 100k');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        monto: 100000,
        categoria: 'sena',
        pacienteNombre: 'Ana',
      },
    });
  });

  test('parsea saldo final con método de pago', () => {
    const result = quickParse('saldo final Lucia 250000 transferencia');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        monto: 250000,
        metodo_pago: 'transferencia',
        categoria: 'saldo_final',
        pacienteNombre: 'Lucia',
      },
    });
  });

  test('parsea cuota asociada a tratamiento', () => {
    const result = quickParse('cuota de ortodoncia de Sofia 75k');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        monto: 75000,
        categoria: 'cuota',
        tratamientoNombre: 'Ortodoncia',
        pacienteNombre: 'Sofia',
      },
    });
  });
});
