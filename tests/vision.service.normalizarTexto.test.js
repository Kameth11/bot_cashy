// Ítem 3.2: normalizarTexto usaba /\b\w/g para capitalizar la primera letra
// de cada palabra. \w no incluye letras con tilde, así que el motor de regex
// trataba una tilde como límite de palabra y capitalizaba también la letra
// siguiente: "fernández" → "FernáNdez", "joaquín" → "JoaquíN",
// "peña" → "PeñA".

const { normalizarTexto } = require('../src/services/vision.service');

describe('normalizarTexto', () => {
  test('nombres con tildes: solo la primera letra de cada palabra se capitaliza', () => {
    expect(normalizarTexto('fernández')).toBe('Fernández');
    expect(normalizarTexto('joaquín')).toBe('Joaquín');
    expect(normalizarTexto('peña')).toBe('Peña');
    expect(normalizarTexto('josé maría gonzález')).toBe('José María González');
  });

  test('la ñ no rompe la capitalización de la palabra siguiente', () => {
    expect(normalizarTexto('ñandú muñoz')).toBe('Ñandú Muñoz');
  });

  test('apóstrofes: capitaliza también después del apóstrofe', () => {
    expect(normalizarTexto("d'amato")).toBe("D'Amato");
    expect(normalizarTexto("o'brien")).toBe("O'Brien");
  });

  test('guiones: capitaliza cada segmento', () => {
    expect(normalizarTexto('maria-jose perez')).toBe('Maria-Jose Perez');
  });

  test('colapsa espacios múltiples y recorta bordes', () => {
    expect(normalizarTexto('  martín   lópez  ')).toBe('Martín López');
  });

  test('null/undefined/vacío da null', () => {
    expect(normalizarTexto(null)).toBeNull();
    expect(normalizarTexto(undefined)).toBeNull();
    expect(normalizarTexto('')).toBeNull();
    expect(normalizarTexto('   ')).toBeNull();
  });

  test('no toca letras ya en mayúscula ni el resto de la palabra', () => {
    expect(normalizarTexto('FERNANDEZ')).toBe('FERNANDEZ');
  });
});
