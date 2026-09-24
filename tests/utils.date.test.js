const { normalizarFecha, esHoy, esEstaSemana, esEsteMes, ahoraArgentina, fechaArgentinaStr, horaArgentinaStr, fechaMananaArgentinaStr, parsearFechaIngresada, resolverFechaAgenda } = require('../src/utils/date');

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

// Ítem 3.1: Railway corre en UTC. 22:30 del 23/09 hora Argentina (UTC-3) es
// 01:30 del 24/09 en UTC — si el código arma la fecha "de ahora" con
// getters locales de Date sin fijar la zona horaria, un movimiento cargado
// a esa hora quedaba con fecha del día SIGUIENTE. Estos tests fuerzan
// process.env.TZ = 'UTC' (simulando Railway) para probar que
// ahoraArgentina/fechaArgentinaStr/horaArgentinaStr siguen dando la hora de
// Argentina sin importar en qué zona horaria corra el proceso.
describe('ahoraArgentina/fechaArgentinaStr/horaArgentinaStr — 22:30 ART simulado con el proceso en UTC', () => {
  const TZ_ORIGINAL = process.env.TZ;
  // 22:30 del 23/09/2026 en Argentina (UTC-3) = 01:30 del 24/09/2026 en UTC.
  const INSTANTE_22_30_ART = new Date(Date.UTC(2026, 8, 24, 1, 30, 0));

  beforeEach(() => {
    process.env.TZ = 'UTC';
    jest.useFakeTimers({ doNotFake: ['nextTick'] }).setSystemTime(INSTANTE_22_30_ART);
  });

  afterEach(() => {
    jest.useRealTimers();
    if (TZ_ORIGINAL === undefined) delete process.env.TZ; else process.env.TZ = TZ_ORIGINAL;
  });

  test('ahoraArgentina() da el 23, no el 24, aunque el proceso esté en UTC', () => {
    const arg = ahoraArgentina();
    expect(arg.getDate()).toBe(23);
    expect(arg.getMonth()).toBe(8); // septiembre
    expect(arg.getFullYear()).toBe(2026);
    expect(arg.getHours()).toBe(22);
    expect(arg.getMinutes()).toBe(30);
  });

  test('fechaArgentinaStr() da "23/09/2026"', () => {
    expect(fechaArgentinaStr()).toBe('23/09/2026');
  });

  test('horaArgentinaStr() da "22:30"', () => {
    expect(horaArgentinaStr()).toBe('22:30');
  });

  test('un movimiento cargado a esta hora cuenta como "hoy" (23/09), no como el 24', () => {
    expect(esHoy('23/09/2026')).toBe(true);
    expect(esHoy('24/09/2026')).toBe(false);
  });

  // Ítem 3.5(a): antes de este fix, agenda.service usaba "hoy" fijo sin forma
  // de guardar para otro día. Acá se prueba que "mañana" se calcula sobre el
  // día en Argentina (23/09 ART), no sobre el día del proceso en UTC (que a
  // esta misma hora ya es 24/09 UTC — si se calculara mal, esta prueba daría
  // "25/09" en vez de "24/09").
  test('fechaMananaArgentinaStr() da "24/09/2026" (el día siguiente al 23 en ART)', () => {
    expect(fechaMananaArgentinaStr()).toBe('24/09/2026');
  });
});

describe('parsearFechaIngresada — fecha escrita a mano para "Otra fecha" de agenda', () => {
  test('parsea DD/MM asumiendo el año actual (en Argentina)', () => {
    expect(parsearFechaIngresada('25/09')).toBe('25/09/2026');
  });

  test('parsea DD/MM/AAAA', () => {
    expect(parsearFechaIngresada('5/1/2027')).toBe('05/01/2027');
  });

  test('acepta "-" como separador', () => {
    expect(parsearFechaIngresada('25-12-2026')).toBe('25/12/2026');
  });

  test('rechaza texto que no es una fecha', () => {
    expect(parsearFechaIngresada('mañana')).toBeNull();
    expect(parsearFechaIngresada('')).toBeNull();
    expect(parsearFechaIngresada(null)).toBeNull();
  });

  test('rechaza mes fuera de rango y día inexistente para el mes', () => {
    expect(parsearFechaIngresada('15/13/2026')).toBeNull();
    expect(parsearFechaIngresada('31/04/2026')).toBeNull(); // abril tiene 30 días
    expect(parsearFechaIngresada('29/02/2026')).toBeNull(); // 2026 no es bisiesto
  });

  test('acepta 29/02 en año bisiesto', () => {
    expect(parsearFechaIngresada('29/02/2028')).toBe('29/02/2028');
  });
});

describe('resolverFechaAgenda — "que turnos tengo hoy/mañana/etc" del intent consulta_agenda', () => {
  const TZ_ORIGINAL = process.env.TZ;
  // Mismo instante que el bloque de arriba: 22:30 del 23/09/2026 ART.
  const INSTANTE_22_30_ART = new Date(Date.UTC(2026, 8, 24, 1, 30, 0));

  beforeEach(() => {
    process.env.TZ = 'UTC';
    jest.useFakeTimers({ doNotFake: ['nextTick'] }).setSystemTime(INSTANTE_22_30_ART);
  });

  afterEach(() => {
    jest.useRealTimers();
    if (TZ_ORIGINAL === undefined) delete process.env.TZ; else process.env.TZ = TZ_ORIGINAL;
  });

  test('null o "hoy" -> hoy (23/09/2026), no ambigua', () => {
    expect(resolverFechaAgenda(null)).toEqual({ fecha: '23/09/2026', ambigua: false });
    expect(resolverFechaAgenda('hoy')).toEqual({ fecha: '23/09/2026', ambigua: false });
    expect(resolverFechaAgenda('Hoy')).toEqual({ fecha: '23/09/2026', ambigua: false });
  });

  test('"mañana" (con o sin tilde) -> 24/09/2026, no ambigua', () => {
    expect(resolverFechaAgenda('mañana')).toEqual({ fecha: '24/09/2026', ambigua: false });
    expect(resolverFechaAgenda('manana')).toEqual({ fecha: '24/09/2026', ambigua: false });
  });

  test('"pasado mañana" -> 25/09/2026, no ambigua', () => {
    expect(resolverFechaAgenda('pasado mañana')).toEqual({ fecha: '25/09/2026', ambigua: false });
    expect(resolverFechaAgenda('pasado manana')).toEqual({ fecha: '25/09/2026', ambigua: false });
  });

  test('fecha explícita DD/MM -> se resuelve vía parsearFechaIngresada, no ambigua', () => {
    expect(resolverFechaAgenda('15/03')).toEqual({ fecha: '15/03/2026', ambigua: false });
  });

  test('texto no reconocido (ej. día de la semana) -> hoy, ambigua:true', () => {
    expect(resolverFechaAgenda('el lunes')).toEqual({ fecha: '23/09/2026', ambigua: true });
    expect(resolverFechaAgenda('bla bla')).toEqual({ fecha: '23/09/2026', ambigua: true });
  });
});
