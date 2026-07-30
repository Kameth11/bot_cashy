const {
  correspondeAlViaje,
  fechaStrAIso,
  evaluarPresupuestosDesde,
  mesActualIso,
  CATEGORIAS_FUERA_DE_VIAJE,
} = require('../src/services/personal.service');

const viaje = {
  idViaje: 'viaje_1',
  nombre: 'Brasil',
  fechaInicio: '10/01/2026',
  fechaFin: '20/01/2026',
};

describe('fechaStrAIso', () => {
  test('convierte DD/MM/YYYY a ISO', () => {
    expect(fechaStrAIso('05/03/2026')).toBe('2026-03-05');
    expect(fechaStrAIso('5/3/2026')).toBe('2026-03-05');
  });

  test('devuelve null ante formatos que no reconoce', () => {
    expect(fechaStrAIso('2026-03-05')).toBeNull();
    expect(fechaStrAIso('')).toBeNull();
    expect(fechaStrAIso(null)).toBeNull();
  });
});

describe('correspondeAlViaje — rango de fechas', () => {
  test('atribuye un gasto dentro del rango', () => {
    expect(correspondeAlViaje(viaje, { fecha: '15/01/2026', categoria: 'comida_afuera' })).toBe(true);
  });

  test('incluye los días de inicio y fin', () => {
    expect(correspondeAlViaje(viaje, { fecha: '10/01/2026', categoria: 'transporte' })).toBe(true);
    expect(correspondeAlViaje(viaje, { fecha: '20/01/2026', categoria: 'transporte' })).toBe(true);
  });

  test('no atribuye gastos fuera del rango', () => {
    expect(correspondeAlViaje(viaje, { fecha: '09/01/2026', categoria: 'transporte' })).toBe(false);
    expect(correspondeAlViaje(viaje, { fecha: '21/01/2026', categoria: 'transporte' })).toBe(false);
  });

  test('sin viaje activo no atribuye nada', () => {
    expect(correspondeAlViaje(null, { fecha: '15/01/2026', categoria: 'transporte' })).toBe(false);
  });

  test('un viaje abierto (sin fecha de fin) atribuye desde el inicio en adelante', () => {
    const abierto = { ...viaje, fechaFin: '' };
    expect(correspondeAlViaje(abierto, { fecha: '28/02/2026', categoria: 'transporte' })).toBe(true);
    expect(correspondeAlViaje(abierto, { fecha: '01/01/2026', categoria: 'transporte' })).toBe(false);
  });

  test('una fecha ilegible no se atribuye', () => {
    expect(correspondeAlViaje(viaje, { fecha: 'ayer', categoria: 'transporte' })).toBe(false);
  });
});

describe('correspondeAlViaje — exclusión de gastos domésticos', () => {
  // El caso que motivó esta regla: pagar la luz durante el viaje no es un
  // gasto del viaje, aunque la fecha caiga justo en el rango.
  test.each([...CATEGORIAS_FUERA_DE_VIAJE])(
    'no atribuye "%s" aunque la fecha caiga dentro del viaje',
    (categoria) => {
      expect(correspondeAlViaje(viaje, { fecha: '15/01/2026', categoria })).toBe(false);
    }
  );

  test.each([
    'transporte',
    'comida_afuera',
    'entretenimiento',
    'supermercado',
    'ropa',
    'tecnologia',
    'regalos',
    'otros',
  ])('sí atribuye "%s" dentro del viaje', (categoria) => {
    expect(correspondeAlViaje(viaje, { fecha: '15/01/2026', categoria })).toBe(true);
  });

  test('la luz durante el viaje queda fuera, la cena queda dentro', () => {
    expect(correspondeAlViaje(viaje, { fecha: '15/01/2026', categoria: 'servicios' })).toBe(false);
    expect(correspondeAlViaje(viaje, { fecha: '15/01/2026', categoria: 'comida_afuera' })).toBe(true);
  });
});

describe('evaluarPresupuestosDesde', () => {
  const presupuestos = [
    { categoria: 'supermercado', montoMensual: 100000, moneda: 'Pesos' },
    { categoria: 'transporte', montoMensual: 50000, moneda: 'Pesos' },
  ];

  const mov = (over) => ({
    tipo: 'Egreso', fecha: '15/07/2026', categoria: 'supermercado',
    monto: 10000, montoPesos: 10000, ...over,
  });

  test('suma solo los egresos del mes y de la categoría', () => {
    const movimientos = [
      mov({ monto: 30000, montoPesos: 30000 }),
      mov({ monto: 20000, montoPesos: 20000 }),
      mov({ categoria: 'transporte', monto: 5000, montoPesos: 5000 }),
      mov({ fecha: '15/06/2026', monto: 99999, montoPesos: 99999 }), // otro mes
      mov({ tipo: 'Ingreso', monto: 99999, montoPesos: 99999 }),     // no es gasto
    ];

    const [superm, transp] = evaluarPresupuestosDesde(movimientos, presupuestos, '2026-07');
    expect(superm).toMatchObject({ gastado: 50000, limite: 100000, porcentaje: 50, restante: 50000, excedido: false, enAlerta: false });
    expect(transp).toMatchObject({ gastado: 5000, porcentaje: 10 });
  });

  test('marca alerta a partir del 80% y excedido arriba del 100%', () => {
    const enAlerta = evaluarPresupuestosDesde([mov({ monto: 80000, montoPesos: 80000 })], presupuestos, '2026-07')[0];
    expect(enAlerta).toMatchObject({ porcentaje: 80, enAlerta: true, excedido: false });

    const excedido = evaluarPresupuestosDesde([mov({ monto: 120000, montoPesos: 120000 })], presupuestos, '2026-07')[0];
    expect(excedido).toMatchObject({ porcentaje: 120, enAlerta: true, excedido: true, restante: 0 });
  });

  test('usa montoPesos para consolidar monedas', () => {
    const enDolares = mov({ moneda: 'Dólares', monto: 50, montoPesos: 70000 });
    expect(evaluarPresupuestosDesde([enDolares], presupuestos, '2026-07')[0].gastado).toBe(70000);
  });

  test('cae a monto cuando no hay montoPesos', () => {
    const sinPesos = mov({ monto: 25000, montoPesos: 0 });
    expect(evaluarPresupuestosDesde([sinPesos], presupuestos, '2026-07')[0].gastado).toBe(25000);
  });

  test('sin gastos da 0% y no alerta', () => {
    expect(evaluarPresupuestosDesde([], presupuestos, '2026-07')[0])
      .toMatchObject({ gastado: 0, porcentaje: 0, enAlerta: false, excedido: false });
  });

  test('los movimientos sin categoría se agrupan en "otros" y no ensucian otra categoría', () => {
    const sinCat = mov({ categoria: null, monto: 40000, montoPesos: 40000 });
    expect(evaluarPresupuestosDesde([sinCat], presupuestos, '2026-07')[0].gastado).toBe(0);
    expect(evaluarPresupuestosDesde([sinCat], [{ categoria: 'otros', montoMensual: 50000, moneda: 'Pesos' }], '2026-07')[0].gastado).toBe(40000);
  });
});

describe('mesActualIso', () => {
  test('devuelve YYYY-MM', () => {
    expect(mesActualIso()).toMatch(/^\d{4}-\d{2}$/);
  });
});
