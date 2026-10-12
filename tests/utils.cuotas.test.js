// Plan de cuotas: reparto exacto en centavos, vencimientos mes a mes y estado de la primera.

const { repartirCuotas, sumarMeses, planDeCuotas, esFechaIso, MAX_CUOTAS } = require('../src/utils/cuotas');

const suma = (xs) => Math.round(xs.reduce((s, x) => s + Math.round(x * 100), 0)) / 100;

describe('repartirCuotas', () => {
  test('división exacta', () => {
    expect(repartirCuotas(300000, 6)).toEqual([50000, 50000, 50000, 50000, 50000, 50000]);
  });

  test('con resto: la última absorbe el redondeo y la suma da EXACTO el total', () => {
    const partes = repartirCuotas(100, 3);
    expect(partes).toEqual([33.33, 33.33, 33.34]);
    expect(suma(partes)).toBe(100);
  });

  test.each([
    [100000, 7], [99.99, 4], [0.05, 3], [1234567.89, 24], [10, 1], [333.33, 12], [1e9, 24],
  ])('la suma de %p en %p cuotas es siempre el total exacto, y ninguna cuota es negativa', (total, n) => {
    const partes = repartirCuotas(total, n);
    expect(partes).toHaveLength(n);
    expect(suma(partes)).toBe(Math.round(total * 100) / 100);
    expect(partes.every(p => p >= 0)).toBe(true);
    // las primeras n-1 son iguales
    expect(new Set(partes.slice(0, -1)).size).toBeLessThanOrEqual(1);
  });

  test('una sola cuota es el total', () => {
    expect(repartirCuotas(12345.67, 1)).toEqual([12345.67]);
  });

  test('un monto negativo (egreso) se trata por su valor absoluto', () => {
    expect(repartirCuotas(-300, 3)).toEqual([100, 100, 100]);
  });

  test('rechaza totales y cantidades inválidos', () => {
    expect(() => repartirCuotas(0, 3)).toThrow('total_invalido');
    expect(() => repartirCuotas('abc', 3)).toThrow('total_invalido');
    expect(() => repartirCuotas(NaN, 3)).toThrow('total_invalido');
    expect(() => repartirCuotas(100, 0)).toThrow('cantidad_invalida');
    expect(() => repartirCuotas(100, -2)).toThrow('cantidad_invalida');
    expect(() => repartirCuotas(100, MAX_CUOTAS + 1)).toThrow('cantidad_invalida');
    expect(() => repartirCuotas(100, 'x')).toThrow('cantidad_invalida');
  });

  test('un total tan chico que no alcanza para un centavo por cuota no inventa plata', () => {
    expect(repartirCuotas(0.02, 3)).toEqual([0, 0, 0.02]);
    expect(suma(repartirCuotas(0.02, 3))).toBe(0.02);
  });
});

describe('sumarMeses', () => {
  test('mes a mes, cruzando el año', () => {
    expect(sumarMeses('2026-10-11', 0)).toBe('2026-10-11');
    expect(sumarMeses('2026-10-11', 1)).toBe('2026-11-11');
    expect(sumarMeses('2026-10-11', 3)).toBe('2027-01-11');
    expect(sumarMeses('2026-10-11', 15)).toBe('2028-01-11');
  });

  test('si el día no existe en el mes destino queda el último día', () => {
    expect(sumarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(sumarMeses('2028-01-31', 1)).toBe('2028-02-29'); // bisiesto
    expect(sumarMeses('2026-08-31', 1)).toBe('2026-09-30');
    expect(sumarMeses('2026-01-30', 2)).toBe('2026-03-30');
  });

  test('fecha inválida', () => {
    expect(() => sumarMeses('11/10/2026', 1)).toThrow('fecha_invalida');
    expect(() => sumarMeses('2026-02-30', 1)).toThrow('fecha_invalida');
    expect(() => sumarMeses('', 1)).toThrow('fecha_invalida');
  });
});

describe('planDeCuotas', () => {
  test('primera cobrada y el resto pendientes, con vencimiento mes a mes', () => {
    const plan = planDeCuotas({ total: 300000, cantidad: 6, primerVencimiento: '2026-10-11', primeraCobrada: true });
    expect(plan).toHaveLength(6);
    expect(plan.map(c => c.estado)).toEqual(['Cobrado', 'Pendiente', 'Pendiente', 'Pendiente', 'Pendiente', 'Pendiente']);
    expect(plan.map(c => c.vencimiento)).toEqual(['2026-10-11', '2026-11-11', '2026-12-11', '2027-01-11', '2027-02-11', '2027-03-11']);
    expect(plan.map(c => c.numero)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.every(c => c.de === 6 && c.monto === 50000)).toBe(true);
  });

  test('todas pendientes si la primera no se cobró', () => {
    const plan = planDeCuotas({ total: 90, cantidad: 3, primerVencimiento: '2026-10-11', primeraCobrada: false });
    expect(plan.every(c => c.estado === 'Pendiente')).toBe(true);
  });

  test('por defecto la primera queda cobrada', () => {
    expect(planDeCuotas({ total: 90, cantidad: 3, primerVencimiento: '2026-10-11' })[0].estado).toBe('Cobrado');
  });

  test('una sola cuota cobrada es un cobro normal', () => {
    const plan = planDeCuotas({ total: 5000, cantidad: 1, primerVencimiento: '2026-10-11' });
    expect(plan).toEqual([{ numero: 1, de: 1, monto: 5000, vencimiento: '2026-10-11', estado: 'Cobrado' }]);
  });

  test('la suma del plan es el total aunque no divida exacto', () => {
    const plan = planDeCuotas({ total: 100000, cantidad: 7, primerVencimiento: '2026-01-31' });
    expect(suma(plan.map(c => c.monto))).toBe(100000);
    expect(plan[1].vencimiento).toBe('2026-02-28');
  });
});

test('esFechaIso', () => {
  expect(esFechaIso('2026-10-11')).toBe(true);
  expect(esFechaIso('2026-02-30')).toBe(false);
  expect(esFechaIso('11/10/2026')).toBe(false);
  expect(esFechaIso(null)).toBe(false);
});
