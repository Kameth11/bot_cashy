const { normalizarFecha, esHoy, esEstaSemana, esEsteMes } = require('../src/utils/date');

function ddmmyyyy(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

describe('normalizarFecha', () => {
  test('parsea DD/MM/YYYY a un Date correcto', () => {
    const d = normalizarFecha('15/03/2026');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // marzo = 2
    expect(d.getDate()).toBe(15);
  });

  test('devuelve null para vacío o basura no parseable', () => {
    expect(normalizarFecha('')).toBeNull();
    expect(normalizarFecha(null)).toBeNull();
    expect(normalizarFecha('no es fecha')).toBeNull();
  });

  // NOTA / candidato a bug: normalizarFecha NO valida rangos. '32/01/2026' no
  // da null, sino que JS lo "desborda" a 01/02/2026. En la práctica las fechas
  // vienen siempre del propio formateo del sistema (DD/MM/YYYY válido), así que
  // no muerde hoy — se documenta el comportamiento actual, no se cambia (la
  // función la usan reportes financieros y un cambio sería de alcance amplio).
  test('[comportamiento actual] no valida rangos: día fuera de rango desborda', () => {
    const d = normalizarFecha('32/01/2026');
    expect(d).toBeInstanceOf(Date);
    expect(d.getMonth()).toBe(1); // desbordó a febrero
  });
});

describe('esHoy', () => {
  test('true para la fecha de hoy, false para ayer', () => {
    const hoy = new Date();
    const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
    expect(esHoy(ddmmyyyy(hoy))).toBe(true);
    expect(esHoy(ddmmyyyy(ayer))).toBe(false);
  });
  test('false para fecha inválida', () => {
    expect(esHoy('basura')).toBe(false);
  });
});

describe('esEstaSemana (ventana móvil ~7 días: hoy y los anteriores)', () => {
  // NOTA: el borde es difuso por hora del día — `inicioSemana` se calcula con
  // la hora actual mientras que las fechas parseadas son a medianoche, así que
  // "hace exactamente 6 días" puede caer justo afuera. Se testea con días
  // claramente dentro (hace 5) y claramente afuera (hace 8) para no depender
  // de la hora a la que corra el test.
  test('true para hoy y hace 5 días, false para hace 8 días', () => {
    const hoy = new Date();
    const hace5 = new Date(); hace5.setDate(hoy.getDate() - 5);
    const hace8 = new Date(); hace8.setDate(hoy.getDate() - 8);
    expect(esEstaSemana(ddmmyyyy(hoy))).toBe(true);
    expect(esEstaSemana(ddmmyyyy(hace5))).toBe(true);
    expect(esEstaSemana(ddmmyyyy(hace8))).toBe(false);
  });
});

describe('esEsteMes', () => {
  test('true para una fecha del mes/año actual', () => {
    const hoy = new Date();
    const otroDiaMismoMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    expect(esEsteMes(ddmmyyyy(otroDiaMismoMes))).toBe(true);
  });
  test('false para el mismo día del mes pasado', () => {
    const hoy = new Date();
    const mesPasado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 15);
    expect(esEsteMes(ddmmyyyy(mesPasado))).toBe(false);
  });
});
