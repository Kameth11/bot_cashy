jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn(() => true) }));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { getSupabase, isAvailable } = require('../src/lib/supabase');
const logger = require('../src/lib/logger');
const { crearSupabaseFalso } = require('./helpers/fake-supabase');
const { verificarTablas } = require('../src/lib/verificar-tablas');
const { TABLAS } = require('../src/lib/tablas');

beforeEach(() => { jest.clearAllMocks(); isAvailable.mockReturnValue(true); });

describe('verificarTablas', () => {
  test('todas presentes → info, sin errores', async () => {
    getSupabase.mockReturnValue(crearSupabaseFalso());
    const r = await verificarTablas(logger);
    expect(r.faltantes).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('TABLAS', expect.stringContaining('verificadas'), expect.anything());
    expect(r.verificadas).toBe(Object.values(TABLAS).filter(t => t.ambito !== 'borrador').length);
  });

  test('falta una tabla obligatoria → logger.error con la tabla, sin lanzar', async () => {
    getSupabase.mockReturnValue(crearSupabaseFalso({ errorEn: { tabla: 'notificaciones', op: 'select', mensaje: 'relation "notificaciones" does not exist', code: '42P01' } }));
    const r = await verificarTablas(logger);
    expect(r.faltantes).toEqual(['notificaciones']);
    expect(logger.error).toHaveBeenCalledWith('TABLAS', expect.stringContaining("'notificaciones'"), { tabla: 'notificaciones' });
  });

  test('falta una tabla opcional → solo warn', async () => {
    getSupabase.mockReturnValue(crearSupabaseFalso({ errorEn: { tabla: 'comprobantes', op: 'select', mensaje: 'does not exist', code: '42P01' } }));
    const r = await verificarTablas(logger);
    expect(r.opcionalesFaltantes).toEqual(['comprobantes']);
    expect(r.faltantes).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test('error pasajero (timeout) → warn, no cuenta como tabla faltante', async () => {
    getSupabase.mockReturnValue(crearSupabaseFalso({ errorEn: { tabla: 'movimientos', op: 'select', mensaje: 'timeout', code: '57014' } }));
    const r = await verificarTablas(logger);
    expect(r.faltantes).toEqual([]);
    expect(r.conError).toEqual(['movimientos']);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('sin Supabase (modo Sheets) no hace nada', async () => {
    isAvailable.mockReturnValue(false);
    const r = await verificarTablas(logger);
    expect(r.verificadas).toBe(0);
    expect(getSupabase).not.toHaveBeenCalled();
  });
});
