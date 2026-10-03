const { AMBITOS, normalizarAmbito, esAmbito, AMBITO_CASA } = require('../src/lib/ambitos');

describe('lib/ambitos', () => {
  test('lista los tres ámbitos', () => {
    expect(AMBITOS).toEqual(['consultorio', 'personal', 'casa']);
  });

  test('normalizarAmbito: valores válidos pasan (sin importar mayúsculas)', () => {
    expect(normalizarAmbito('Personal')).toBe('personal');
    expect(normalizarAmbito(' CASA ')).toBe('casa');
  });

  test('valores desconocidos o ausentes caen en consultorio (comportamiento histórico)', () => {
    expect(normalizarAmbito('otra cosa')).toBe('consultorio');
    expect(normalizarAmbito(undefined)).toBe('consultorio');
    expect(normalizarAmbito(null)).toBe('consultorio');
  });

  test('esAmbito lee entities.ambito', () => {
    expect(esAmbito({ ambito: 'casa' }, AMBITO_CASA)).toBe(true);
    expect(esAmbito({ ambito: 'personal' }, AMBITO_CASA)).toBe(false);
    expect(esAmbito({}, 'consultorio')).toBe(true);
    expect(esAmbito(null, 'consultorio')).toBe(true);
  });
});
