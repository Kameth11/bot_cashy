const { calcularSaldos, repartir } = require('../src/lib/casa-saldos');

const M = [{ id: 'ana' }, { id: 'beto' }, { id: 'cami' }];
const saldoDe = (r, id, moneda = 'Pesos') => r.porMoneda[moneda].saldos.find((s) => s.id === id).saldo;
const sumaSaldos = (r, moneda = 'Pesos') => Math.round(r.porMoneda[moneda].saldos.reduce((a, s) => a + s.saldo * 100, 0));

describe('repartir (centavos)', () => {
  test('$100 entre 3 no pierde ni crea centavos y el resto va al pagador', () => {
    const p = repartir(10000, ['ana', 'beto', 'cami'], 'beto');
    expect([...p.values()].reduce((a, b) => a + b, 0)).toBe(10000);
    expect(p.get('beto')).toBe(3334);
    expect(p.get('ana')).toBe(3333);
  });

  test('si el pagador no participa, el resto va al primero', () => {
    const p = repartir(10000, ['ana', 'beto', 'cami'], 'zeta');
    expect(p.get('ana')).toBe(3334);
  });
});

describe('calcularSaldos', () => {
  test('un gasto entre todos: el pagador recupera lo que puso menos su parte', () => {
    const r = calcularSaldos(M, [{ tipo: 'gasto', monto: 30000, moneda: 'Pesos', pagoPor: 'ana', repartoEntre: 'todos' }]);
    expect(saldoDe(r, 'ana')).toBe(20000);
    expect(saldoDe(r, 'beto')).toBe(-10000);
    expect(saldoDe(r, 'cami')).toBe(-10000);
    expect(r.porMoneda.Pesos.totalGastado).toBe(30000);
    expect(sumaSaldos(r)).toBe(0);
  });

  test('reparto entre algunos: los demás no deben nada', () => {
    const r = calcularSaldos(M, [{ tipo: 'gasto', monto: 1000, moneda: 'Pesos', pagoPor: 'ana', repartoEntre: ['ana', 'beto'] }]);
    expect(saldoDe(r, 'ana')).toBe(500);
    expect(saldoDe(r, 'beto')).toBe(-500);
    expect(saldoDe(r, 'cami')).toBe(0);
  });

  test('redondeo: $100 entre 3, la suma de saldos sigue siendo 0', () => {
    const r = calcularSaldos(M, [{ tipo: 'gasto', monto: 100, moneda: 'Pesos', pagoPor: 'ana', repartoEntre: 'todos' }]);
    expect(sumaSaldos(r)).toBe(0);
    expect(saldoDe(r, 'beto')).toBe(-33.33);
    expect(saldoDe(r, 'cami')).toBe(-33.33);
    expect(saldoDe(r, 'ana')).toBe(66.66);
  });

  test('gastos cruzados se compensan', () => {
    const r = calcularSaldos(M.slice(0, 2), [
      { tipo: 'gasto', monto: 1000, moneda: 'Pesos', pagoPor: 'ana', repartoEntre: 'todos' },
      { tipo: 'gasto', monto: 600, moneda: 'Pesos', pagoPor: 'beto', repartoEntre: 'todos' },
    ]);
    expect(saldoDe(r, 'ana')).toBe(200);
    expect(saldoDe(r, 'beto')).toBe(-200);
    expect(r.porMoneda.Pesos.transferencias).toEqual([{ de: 'beto', para: 'ana', monto: 200 }]);
  });

  test('liquidación: reduce la deuda', () => {
    const r = calcularSaldos(M.slice(0, 2), [
      { tipo: 'gasto', monto: 1000, moneda: 'Pesos', pagoPor: 'ana', repartoEntre: 'todos' },
      { tipo: 'liquidacion', monto: 500, moneda: 'Pesos', pagoPor: 'beto', para: 'ana' },
    ]);
    expect(saldoDe(r, 'ana')).toBe(0);
    expect(saldoDe(r, 'beto')).toBe(0);
    expect(r.porMoneda.Pesos.transferencias).toEqual([]);
  });

  test('liquidación parcial deja el resto pendiente', () => {
    const r = calcularSaldos(M.slice(0, 2), [
      { tipo: 'gasto', monto: 1000, moneda: 'Pesos', pagoPor: 'ana', repartoEntre: 'todos' },
      { tipo: 'liquidacion', monto: 200, moneda: 'Pesos', pagoPor: 'beto', para: 'ana' },
    ]);
    expect(r.porMoneda.Pesos.transferencias).toEqual([{ de: 'beto', para: 'ana', monto: 300 }]);
  });

  test('cada moneda se calcula por separado, sin convertir', () => {
    const r = calcularSaldos(M.slice(0, 2), [
      { tipo: 'gasto', monto: 1000, moneda: 'Pesos', pagoPor: 'ana', repartoEntre: 'todos' },
      { tipo: 'gasto', monto: 50, moneda: 'Euros', pagoPor: 'beto', repartoEntre: 'todos' },
    ]);
    expect(saldoDe(r, 'ana', 'Pesos')).toBe(500);
    expect(saldoDe(r, 'beto', 'Euros')).toBe(25);
    expect(Object.keys(r.porMoneda).sort()).toEqual(['Euros', 'Pesos']);
  });

  test('transferencias: tres personas quedan saldadas con pocas transferencias', () => {
    const r = calcularSaldos(M, [
      { tipo: 'gasto', monto: 9000, moneda: 'Pesos', pagoPor: 'ana', repartoEntre: 'todos' },
      { tipo: 'gasto', monto: 3000, moneda: 'Pesos', pagoPor: 'beto', repartoEntre: 'todos' },
    ]);
    const { transferencias } = r.porMoneda.Pesos;
    expect(transferencias.length).toBeLessThanOrEqual(2);
    // aplicar las transferencias deja todos en cero
    const saldos = Object.fromEntries(r.porMoneda.Pesos.saldos.map((s) => [s.id, Math.round(s.saldo * 100)]));
    for (const t of transferencias) { saldos[t.de] += Math.round(t.monto * 100); saldos[t.para] -= Math.round(t.monto * 100); }
    expect(Object.values(saldos).every((v) => v === 0)).toBe(true);
  });

  test('"todos" usa los miembros actuales; ids explícitos de alguien que ya no está se conservan', () => {
    const r = calcularSaldos(M.slice(0, 2), [
      { tipo: 'gasto', monto: 900, moneda: 'Pesos', pagoPor: 'ana', repartoEntre: ['ana', 'beto', 'ex'] },
    ]);
    expect(saldoDe(r, 'ex')).toBe(-300);
    expect(sumaSaldos(r)).toBe(0);
  });

  test('ignora movimientos inválidos y los cuenta', () => {
    const r = calcularSaldos(M, [
      { tipo: 'gasto', monto: -5, moneda: 'Pesos', pagoPor: 'ana', repartoEntre: 'todos' },
      { tipo: 'gasto', monto: 'abc', moneda: 'Pesos', pagoPor: 'ana', repartoEntre: 'todos' },
      { tipo: 'gasto', monto: 100, moneda: 'Pesos', repartoEntre: 'todos' },
      { tipo: 'liquidacion', monto: 100, moneda: 'Pesos', pagoPor: 'ana', para: 'ana' },
      { tipo: 'gasto', monto: 300, moneda: 'Pesos', pagoPor: 'ana', repartoEntre: 'todos' },
    ]);
    expect(r.ignorados).toBe(4);
    expect(r.porMoneda.Pesos.totalGastado).toBe(300);
  });

  test('sin movimientos: sin monedas y sin errores', () => {
    expect(calcularSaldos(M, [])).toEqual({ porMoneda: {}, ignorados: 0 });
    expect(calcularSaldos(null, null)).toEqual({ porMoneda: {}, ignorados: 0 });
  });

  test('moneda ausente cuenta como Pesos', () => {
    const r = calcularSaldos(M.slice(0, 2), [{ tipo: 'gasto', monto: 200, pagoPor: 'ana', repartoEntre: 'todos' }]);
    expect(saldoDe(r, 'ana')).toBe(100);
  });
});
