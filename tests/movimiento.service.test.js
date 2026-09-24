const {
  generarIDUnico,
  calcularMontoPesos,
  crearTimestampMovimiento,
} = require('../src/services/movimiento.service');
const state = require('../src/state');

describe('generarIDUnico', () => {
  test('tiene el formato mov_<timestamp>_<sufijo>', () => {
    expect(generarIDUnico()).toMatch(/^mov_\d+_[a-z0-9]+$/);
  });

  test('no colisiona en una ráfaga de llamadas', () => {
    const ids = new Set();
    for (let i = 0; i < 200; i++) ids.add(generarIDUnico());
    expect(ids.size).toBe(200);
  });
});

describe('calcularMontoPesos', () => {
  const dolarOriginal = state.cotizacionDolar;
  const euroOriginal = state.cotizacionEuro;
  afterEach(() => {
    state.cotizacionDolar = dolarOriginal;
    state.cotizacionEuro = euroOriginal;
  });

  test('Pesos pasa el monto sin convertir', () => {
    expect(calcularMontoPesos(5000, 'Pesos')).toBe(5000);
  });

  test('Dólares multiplica por la cotización pasada explícitamente (valor absoluto)', () => {
    expect(calcularMontoPesos(50, 'Dólares', 1000)).toBe(50000);
    expect(calcularMontoPesos(-50, 'Dólares', 1000)).toBe(50000); // usa abs
  });

  test('Dólares usa state.cotizacionDolar si no se pasa cotización', () => {
    state.cotizacionDolar = 1200;
    expect(calcularMontoPesos(10, 'Dólares')).toBe(12000);
  });

  test('Euros usa state.cotizacionEuro', () => {
    state.cotizacionEuro = 1300;
    expect(calcularMontoPesos(10, 'Euros')).toBe(13000);
  });

  // NOTA / limitación conocida: si no hay cotización disponible (ni parámetro
  // ni state), devuelve el monto SIN convertir (no lanza ni avisa). En prod
  // COTIZACION_DEFAULT siempre setea state.cotizacionDolar al boot, así que no
  // muerde, pero queda documentado el comportamiento silencioso.
  test('[limitación] sin cotización disponible devuelve el monto crudo', () => {
    state.cotizacionDolar = null;
    expect(calcularMontoPesos(50, 'Dólares')).toBe(50);
  });
});

describe('crearTimestampMovimiento', () => {
  test('formatea fecha DD/MM/YYYY y hora HH:MM con padding', () => {
    const { fechaStr, horaStr } = crearTimestampMovimiento(new Date(2026, 2, 5, 9, 7));
    expect(fechaStr).toBe('05/03/2026');
    expect(horaStr).toBe('09:07');
  });

  // Ítem 3.1: Railway corre en UTC. 22:30 del 23/09 hora Argentina es 01:30
  // del 24/09 en UTC. Antes del fix, crearTimestampMovimiento leía getters
  // locales (now.getDate()/getHours()) de un Date sin fijar zona horaria, así
  // que en un proceso en UTC un movimiento cargado a esa hora quedaba
  // fechado el 24, no el 23. Ahora delega en fechaArgentinaStr/horaArgentinaStr
  // (src/utils/date.js), que resuelven la zona horaria de forma explícita con
  // Intl — el resultado es el mismo sin importar en qué TZ corra el proceso
  // (no se puede simular "proceso en UTC" de forma confiable mutando
  // process.env.TZ a mitad de un test de Jest, así que esto se verifica
  // afuera, en tests/utils.date.test.js, con el caso general).
  test('a las 22:30 hora Argentina (instante UTC 01:30 del día siguiente), la fecha es la del día anterior', () => {
    const instante22_30ART = new Date(Date.UTC(2026, 8, 24, 1, 30, 0));
    const { fechaStr, horaStr } = crearTimestampMovimiento(instante22_30ART);
    expect(fechaStr).toBe('23/09/2026');
    expect(horaStr).toBe('22:30');
  });
});
