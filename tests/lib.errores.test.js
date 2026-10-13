jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const logger = require('../src/lib/logger');
const { esErrorDeProgramacion, esErrorDeConfiguracionSupabase, esErrorAccionable, logFallo } = require('../src/lib/errores');

beforeEach(() => jest.clearAllMocks());

describe('clasificación', () => {
  test('TypeError / ReferenceError y las guardas de aislamiento son errores de programación', () => {
    expect(esErrorDeProgramacion(new TypeError('x is not a function'))).toBe(true);
    expect(esErrorDeProgramacion(new ReferenceError('y'))).toBe(true);
    expect(esErrorDeProgramacion(new Error("Tabla 'notificaciones' no esta en SCOPED_TABLES de tenant-db.js."))).toBe(true);
    expect(esErrorDeProgramacion(new Error("Tabla 'x' no es una tabla personal: usar forTenant()"))).toBe(true);
    expect(esErrorDeProgramacion(new Error('forPersona() llamado sin userId: query bloqueada'))).toBe(true);
  });

  test('un fallo de red o un error genérico NO es de programación', () => {
    expect(esErrorDeProgramacion(new Error('fetch failed'))).toBe(false);
    expect(esErrorDeProgramacion(new Error('ETIMEDOUT'))).toBe(false);
    expect(esErrorDeProgramacion('texto')).toBe(false);
    expect(esErrorDeProgramacion(null)).toBe(false);
  });

  test('códigos de esquema/permisos de Supabase son de configuración; timeouts no', () => {
    expect(esErrorDeConfiguracionSupabase({ code: '42501', message: 'permission denied' })).toBe(true);
    expect(esErrorDeConfiguracionSupabase({ code: '42703', message: 'column x does not exist' })).toBe(true);
    expect(esErrorDeConfiguracionSupabase({ code: 'PGRST205', message: 'not in schema cache' })).toBe(true);
    expect(esErrorDeConfiguracionSupabase({ code: '57014', message: 'canceling statement due to timeout' })).toBe(false);
    expect(esErrorDeConfiguracionSupabase({ message: 'sin código' })).toBe(false);
    expect(esErrorDeConfiguracionSupabase(null)).toBe(false);
  });

  test('esErrorAccionable junta los dos casos', () => {
    expect(esErrorAccionable(new TypeError('x'))).toBe(true);
    expect(esErrorAccionable({ code: '42501' })).toBe(true);
    expect(esErrorAccionable(new Error('fetch failed'))).toBe(false);
  });
});

describe('logFallo', () => {
  test('accionable → logger.error', () => {
    const r = logFallo('NOTIF', 'No se pudo', new TypeError('boom'), { userId: 1 });
    expect(r).toBe(true);
    expect(logger.error).toHaveBeenCalledWith('NOTIF', 'No se pudo', expect.objectContaining({ userId: 1, err: 'boom' }));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('transitorio → logger.warn', () => {
    const r = logFallo('NOTIF', 'No se pudo', new Error('fetch failed'));
    expect(r).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('NOTIF', 'No se pudo', expect.objectContaining({ err: 'fetch failed' }));
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('error de Supabase con código de configuración → error, con el código en el log', () => {
    logFallo('CHAT_WEB', 'No se pudo leer', { message: 'permission denied', code: '42501' });
    expect(logger.error).toHaveBeenCalledWith('CHAT_WEB', 'No se pudo leer', expect.objectContaining({ codigo: '42501' }));
  });
});

describe('logSiAccionable', () => {
  const { logSiAccionable } = require('../src/lib/errores');

  test('un error de código se loguea como error', () => {
    expect(logSiAccionable('CASA', 'm', new TypeError('x'))).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });

  test('un fallo común no deja ni un warn (es lo esperable en lo best-effort)', () => {
    expect(logSiAccionable('CASA', 'm', new Error('socket cerrado'))).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
