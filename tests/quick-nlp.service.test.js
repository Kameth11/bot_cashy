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
        tratamientoNombre: 'Consulta',
      },
    });
  });

  test('toma al paciente correcto cuando el nombre viene antes de vino por consulta', () => {
    const result = quickParse('Diego vino por consulta');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        descripcion: 'Diego',
        monto: null,
        moneda: 'Pesos',
        categoria: 'consulta',
        pacienteNombre: 'Diego',
        profesionalNombre: null,
        tratamientoNombre: 'Consulta',
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

  test('parsea tu ejemplo con paciente como destinatario del pago', () => {
    const result = quickParse('Le pagaron a Diego 400mil pesos en efectivo');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        descripcion: 'Diego',
        monto: 400000,
        metodo_pago: 'efectivo',
        pacienteNombre: 'Diego',
      },
    });
  });

  test('no rompe si hay monto pero falta descripcion en cobro explicito', () => {
    const result = quickParse('me pagaron 400mil efectivo');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        descripcion: null,
        monto: 400000,
        metodo_pago: 'efectivo',
        pacienteNombre: null,
      },
    });
  });

  test('parsea paciente cuando el nombre va primero en un cobro', () => {
    const result = quickParse('Diego me pagó 400mil en efectivo');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        descripcion: 'Diego',
        monto: 400000,
        metodo_pago: 'efectivo',
        pacienteNombre: 'Diego',
      },
    });
  });

  test('no arrastra conectores al paciente cuando falta monto', () => {
    const result = quickParse('Le pagaron a Diego en efectivo');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        descripcion: 'Diego',
        metodo_pago: 'efectivo',
        pacienteNombre: 'Diego',
      },
    });
  });

  test('parsea transferencia hacia el paciente usando le transfirieron', () => {
    const result = quickParse('Le transfirieron a Diego 400 mil');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        descripcion: 'Diego',
        monto: 400000,
        pacienteNombre: 'Diego',
      },
    });
  });

  test('separa destinatario y pagador en ingresos de terceros', () => {
    const result = quickParse('Le pagaron a Laura de DientesFacil 400mil pesos en efectivo');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        descripcion: 'Laura',
        monto: 400000,
        metodo_pago: 'efectivo',
        pacienteNombre: 'Laura',
        pagadorNombre: 'DientesFacil',
      },
    });
  });

  test('prioriza al paciente correcto cuando el sujeto le paga al profesional por consulta', () => {
    const result = quickParse('Laura Santillan le pagó a Diego 500000 pesos en efectivo por una consulta');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        descripcion: 'Laura Santillan',
        monto: 500000,
        metodo_pago: 'efectivo',
        categoria: 'consulta',
        pacienteNombre: 'Laura Santillan',
        pagadorNombre: 'Laura Santillan',
        profesionalNombre: 'Diego',
        tratamientoNombre: 'Consulta',
      },
    });
  });

  test('parsea gasto cuando una persona le paga a un proveedor no clínico', () => {
    const result = quickParse('Laura Santillan le pagó al gasista 500000 pesos en efectivo');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'gasto',
        descripcion: 'Gasista',
        monto: 500000,
        metodo_pago: 'efectivo',
        proveedorNombre: 'Gasista',
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

  test('parsea pago al proveedor con artículo "al"', () => {
    const result = quickParse('se le pago al gasista 400 euros');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'gasto',
        monto: 400,
        moneda: 'Euros',
        proveedorNombre: 'Gasista',
      },
    });
  });

  test('parsea pago al proveedor con "pagué al"', () => {
    const result = quickParse('pagué al electricista 15000');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'gasto',
        monto: 15000,
        proveedorNombre: 'Electricista',
      },
    });
  });

  test('parsea pago al proveedor con "le pagamos al"', () => {
    const result = quickParse('le pagamos al plomero $8000 transferencia');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'gasto',
        monto: 8000,
        moneda: 'Pesos',
        metodo_pago: 'transferencia',
        proveedorNombre: 'Plomero',
      },
    });
  });

  // Caso reportado: "se pagó" estaba en la lista de palabras de ingreso sin
  // distinguir si el pago va HACIA un tercero (egreso) o es la consulta que
  // cobramos (ingreso); además el nombre se "tragaba" la cláusula de deuda
  // siguiente. Ver ARCHITECTURE.md / quick_nlp.service.js VERBOS_PAGO_A_TERCERO.
  test('parsea pago parcial a un tercero con deuda residual (egreso)', () => {
    const result = quickParse('Se pago 300 dolares a financiera juan carlos debemos todavia 300 dolares mas');

    expect(result).toMatchObject({
      intent: 'pago_parcial_con_deuda',
      entities: {
        montoPagado: 300,
        monedaPagada: 'Dólares',
        montoDeuda: 300,
        monedaDeuda: 'Dólares',
        proveedorNombre: 'Financiera Juan Carlos',
      },
    });
  });

  test('parsea pago parcial a un tercero con conector "y" y "quedamos debiendo"', () => {
    const result = quickParse('pagamos 500 a Dental Sur y quedamos debiendo 200');

    expect(result).toMatchObject({
      intent: 'pago_parcial_con_deuda',
      entities: {
        montoPagado: 500,
        montoDeuda: 200,
        proveedorNombre: 'Dental Sur',
      },
    });
  });

  test('pago simple a un tercero sin deuda residual se interpreta como egreso', () => {
    const result = quickParse('Se pago 300 dolares a la financiera');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'gasto',
        monto: 300,
        moneda: 'Dólares',
      },
    });
  });

  test('no rompe "se pagó la consulta" como ingreso (sin tercero explícito)', () => {
    const result = quickParse('se pago la consulta de Juan Perez 15000 efectivo');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        monto: 15000,
      },
    });
  });

  test('"le transfirieron/pagaron a X" sigue siendo ingreso (no lo roba el matcher de egreso)', () => {
    const result = quickParse('Le transfirieron a Diego 400 mil');

    expect(result).toMatchObject({
      intent: 'registrar_movimiento',
      entities: {
        tipo: 'ingreso',
        pacienteNombre: 'Diego',
      },
    });
  });

  test('extrae correctamente cuando "de" se repite antes y después del nombre', () => {
    const result = quickParse('cuota de ortodoncia de Sofia 75k');

    expect(result).toMatchObject({
      entities: { pacienteNombre: 'Sofia' },
    });
  });
});
