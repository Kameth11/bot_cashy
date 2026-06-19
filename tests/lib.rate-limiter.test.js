const { createLimiter } = require('../src/lib/rate-limiter');

describe('lib/rate-limiter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('permite hasta max llamadas dentro de la ventana y bloquea la siguiente', () => {
    const limiter = createLimiter({ windowMs: 1000, max: 3 });

    expect(limiter('k1')).toEqual({ allowed: true });
    expect(limiter('k1')).toEqual({ allowed: true });
    expect(limiter('k1')).toEqual({ allowed: true });
    expect(limiter('k1')).toEqual({ allowed: false });
  });

  test('resetea el contador despues de que expira la ventana', () => {
    const limiter = createLimiter({ windowMs: 1000, max: 1 });

    expect(limiter('k1')).toEqual({ allowed: true });
    expect(limiter('k1')).toEqual({ allowed: false });

    jest.advanceTimersByTime(1001);

    expect(limiter('k1')).toEqual({ allowed: true });
  });

  test('cada key tiene su propio contador independiente', () => {
    const limiter = createLimiter({ windowMs: 1000, max: 1 });

    expect(limiter('a')).toEqual({ allowed: true });
    expect(limiter('b')).toEqual({ allowed: true });
    expect(limiter('a')).toEqual({ allowed: false });
    expect(limiter('b')).toEqual({ allowed: false });
  });
});
