// Ítem 3.1: fechaHoyStr() armaba la fecha con getters locales de un Date sin
// fijar zona horaria. Ahora delega en fechaArgentinaStr (src/utils/date.js),
// que resuelve la zona horaria de forma explícita con Intl. Se prueba con
// jest.setSystemTime (que sí cambia el instante real que ve `new Date()`,
// a diferencia de mutar process.env.TZ a mitad de un test) fijando el reloj
// a las 22:30 del 23/09 hora Argentina.

const { fechaHoyStr } = require('../src/services/agenda.service');

describe('fechaHoyStr — 22:30 hora Argentina', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('da la fecha del 23, no la del 24, aunque el instante UTC ya sea el día siguiente', () => {
    // 22:30 del 23/09/2026 en Argentina (UTC-3) = 01:30 del 24/09/2026 en UTC.
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 8, 24, 1, 30, 0)));
    expect(fechaHoyStr()).toBe('23/09/2026');
  });
});
