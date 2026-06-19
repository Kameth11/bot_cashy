const logger = require('../src/lib/logger');

describe('lib/logger - redact', () => {
  test('enmascara valores de keys sensibles', () => {
    const out = logger.redact({ telegramId: '123', code: '482913', token: 'abc', password: 'x', jwtSecret: 'y' });
    expect(out).toEqual({
      telegramId: '123',
      code: '[REDACTED]',
      token: '[REDACTED]',
      password: '[REDACTED]',
      jwtSecret: '[REDACTED]',
    });
  });

  test('no toca keys no sensibles', () => {
    const out = logger.redact({ userId: '123', monto: 5000, tipo: 'Ingreso' });
    expect(out).toEqual({ userId: '123', monto: 5000, tipo: 'Ingreso' });
  });

  test('redacta de forma recursiva en objetos anidados', () => {
    const out = logger.redact({ userId: '123', meta: { code: '999999' } });
    expect(out.meta.code).toBe('[REDACTED]');
  });

  test('deja pasar valores undefined/null sin redactar', () => {
    const out = logger.redact({ code: undefined, token: null });
    expect(out).toEqual({ code: undefined, token: null });
  });
});

describe('lib/logger - niveles', () => {
  test('info y warn/error/audit escriben una linea JSON parseable', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    logger.info('API', 'mensaje info', { foo: 'bar' });
    logger.warn('AUTH', 'mensaje warn');
    logger.error('AUTH', 'mensaje error', { err: 'boom' });
    logger.audit('auth_code_requested', { telegramId: '123', code: '999999' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(3);

    const infoLine = JSON.parse(logSpy.mock.calls[0][0]);
    expect(infoLine).toMatchObject({ level: 'info', scope: 'API', message: 'mensaje info', foo: 'bar' });

    const auditLine = JSON.parse(errSpy.mock.calls[2][0]);
    expect(auditLine.level).toBe('audit');
    expect(auditLine.scope).toBe('auth_code_requested');
    expect(auditLine.telegramId).toBe('123');
    expect(auditLine.code).toBe('[REDACTED]');

    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});
