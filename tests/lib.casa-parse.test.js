const { parsearMontoTexto, parsearMoneda, buscarMiembro, buscarCasa, parsearSaldar } = require('../src/lib/casa-parse');

describe('parsearMontoTexto', () => {
  test.each([
    ['5000', 5000], ['5.000', 5000], ['5.000,50', 5000.5], ['1,234.50', 1234.5], ['5,5', 5.5],
    ['$ 80k', 80000], ['1.5k', 1500], ['2mil', 2000], ['$45.300', 45300], ['150', 150],
  ])('%s -> %s', (entrada, esperado) => {
    expect(parsearMontoTexto(entrada)).toBe(esperado);
  });

  test.each(['', 'abc', '0', '-5', null, undefined, '1,2,3x'])('%p -> null', (entrada) => {
    expect(parsearMontoTexto(entrada)).toBeNull();
  });
});

describe('parsearMoneda', () => {
  test('reconoce dólares, euros y pesos', () => {
    expect(parsearMoneda('usd')).toBe('Dólares');
    expect(parsearMoneda('dólares')).toBe('Dólares');
    expect(parsearMoneda('EUR')).toBe('Euros');
    expect(parsearMoneda('€')).toBe('Euros');
    expect(parsearMoneda('pesos')).toBe('Pesos');
  });
  test('otra cosa -> null', () => {
    expect(parsearMoneda('ana')).toBeNull();
    expect(parsearMoneda('')).toBeNull();
  });
});

const M = [{ id: '1', nombre: 'Ana' }, { id: '2', nombre: 'Beto' }, { id: '3', nombre: 'Berta' }, { id: '4', nombre: 'Hijo Tomás' }];

describe('buscarMiembro', () => {
  test('exacto, sin tildes ni mayúsculas', () => {
    expect(buscarMiembro(M, 'ANA').miembro.id).toBe('1');
    expect(buscarMiembro(M, 'hijo tomas').miembro.id).toBe('4');
  });
  test('prefijo único', () => {
    expect(buscarMiembro(M, 'An').miembro.id).toBe('1');
    expect(buscarMiembro(M, 'Bet').miembro.id).toBe('2');
  });
  test('prefijo ambiguo NO adivina', () => {
    const r = buscarMiembro(M, 'Be');
    expect(r.error).toBe('ambiguo');
    expect(r.candidatos.map((c) => c.nombre).sort()).toEqual(['Berta', 'Beto']);
  });
  test('un exacto gana sobre prefijos', () => {
    expect(buscarMiembro([{ id: '1', nombre: 'Ana' }, { id: '2', nombre: 'Anabel' }], 'ana').miembro.id).toBe('1');
  });
  test('no encontrado / vacío', () => {
    expect(buscarMiembro(M, 'Zoe').error).toBe('no_encontrado');
    expect(buscarMiembro(M, '').error).toBe('no_encontrado');
    expect(buscarMiembro(null, 'Ana').error).toBe('no_encontrado');
  });
});

describe('buscarCasa', () => {
  const casas = [{ casaId: 'c1', nombre: 'Casa' }, { casaId: 'c2', nombre: 'Casa Dinamarca' }];
  test('exacto gana sobre prefijo', () => {
    expect(buscarCasa(casas, 'casa').casa.casaId).toBe('c1');
    expect(buscarCasa(casas, 'dinamarca').error).toBe('no_encontrado');
    expect(buscarCasa(casas, 'Casa Din').casa.casaId).toBe('c2');
  });
});

describe('parsearSaldar', () => {
  test.each([
    ['Ana 5000', { nombre: 'Ana', monto: 5000, moneda: 'Pesos' }],
    ['5000 Ana', { nombre: 'Ana', monto: 5000, moneda: 'Pesos' }],
    ['a Ana 5.000', { nombre: 'Ana', monto: 5000, moneda: 'Pesos' }],
    ['Hijo Tomás 20 usd', { nombre: 'Hijo Tomás', monto: 20, moneda: 'Dólares' }],
    ['Ana 30 euros', { nombre: 'Ana', monto: 30, moneda: 'Euros' }],
    ['Ana 80k', { nombre: 'Ana', monto: 80000, moneda: 'Pesos' }],
  ])('%s', (entrada, esperado) => {
    expect(parsearSaldar(entrada)).toEqual(esperado);
  });

  test.each(['', 'Ana', '5000', 'Ana pesos'])('%p -> null', (entrada) => {
    expect(parsearSaldar(entrada)).toBeNull();
  });
});
