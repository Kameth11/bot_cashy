// Servicio de persistencia del historial: una fila por persona en chat_historial,
// siempre vía forPersona (aislada por tenant Y por persona) y best-effort.

jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn(() => true) }));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn(async () => 'tenant-1') }));
jest.mock('../src/services/db.service', () => ({ ensureProfile: jest.fn(async () => true) }));

const { getSupabase } = require('../src/lib/supabase');
const logger = require('../src/lib/logger');
const { resolveTenantId } = require('../src/services/tenant.service');
const { ensureProfile } = require('../src/services/db.service');
const servicio = require('../src/services/chat-historial.service');
const { crearSupabaseFalso } = require('./helpers/fake-supabase');

const msg = (id, texto) => ({ id, de: 'yo', texto, botones: [], ts: 1 });

let fake;
beforeEach(() => {
  servicio._resetParaTests();
  jest.clearAllMocks();
  resolveTenantId.mockResolvedValue('tenant-1');
  fake = crearSupabaseFalso();
  getSupabase.mockReturnValue(fake);
});

describe('guardar / cargar', () => {
  test('guarda y vuelve a leer lo mismo', async () => {
    const estado = { mensajes: [msg(1, 'hola'), msg(2, 'chau')], ultimoId: 2, rev: 5 };
    expect(await servicio.guardar(7, estado)).toBe(true);
    expect(await servicio.cargar(7)).toEqual(estado);
    expect(ensureProfile).toHaveBeenCalledWith(7);
  });

  test('guardar dos veces actualiza la misma fila (upsert por persona)', async () => {
    await servicio.guardar(7, { mensajes: [msg(1, 'a')], ultimoId: 1, rev: 1 });
    await servicio.guardar(7, { mensajes: [msg(1, 'a'), msg(2, 'b')], ultimoId: 2, rev: 2 });
    expect((await servicio.cargar(7)).mensajes).toHaveLength(2);
    const upserts = fake.llamadas.filter(q => q.op === 'upsert');
    expect(upserts[1].opts).toEqual({ onConflict: 'user_id' });
  });

  test('una persona NO ve ni pisa el historial de otra', async () => {
    await servicio.guardar(7, { mensajes: [msg(1, 'secreto de 7')], ultimoId: 1, rev: 1 });
    expect(await servicio.cargar(8)).toBeNull();
    await servicio.guardar(8, { mensajes: [msg(1, 'de 8')], ultimoId: 1, rev: 1 });
    expect((await servicio.cargar(7)).mensajes[0].texto).toBe('secreto de 7');
    expect((await servicio.cargar(8)).mensajes[0].texto).toBe('de 8');
  });

  test('cada consulta va acotada por tenant y por persona', async () => {
    await servicio.cargar(7);
    const q = fake.llamadas[fake.llamadas.length - 1];
    expect(q.t).toBe('chat_historial');
    expect(q.filtros).toEqual({ tenant_id: 'tenant-1', user_id: 7 });
  });

  test('sin fila guardada devuelve null', async () => {
    expect(await servicio.cargar(7)).toBeNull();
  });
});

describe('best-effort: nunca rompe el chat', () => {
  test('sin Supabase: cargar da null y guardar da false', async () => {
    getSupabase.mockReturnValue(null);
    expect(await servicio.cargar(7)).toBeNull();
    expect(await servicio.guardar(7, { mensajes: [], ultimoId: 0, rev: 0 })).toBe(false);
  });

  test('persona sin tenant: no hace nada', async () => {
    resolveTenantId.mockResolvedValue(null);
    expect(await servicio.cargar(7)).toBeNull();
    expect(await servicio.guardar(7, { mensajes: [], ultimoId: 0, rev: 0 })).toBe(false);
  });

  test('error de la base: se loguea y se devuelve null/false', async () => {
    fake = crearSupabaseFalso({ errorEn: { tabla: 'chat_historial', op: 'upsert', mensaje: 'timeout' } });
    getSupabase.mockReturnValue(fake);
    expect(await servicio.guardar(7, { mensajes: [], ultimoId: 0, rev: 0 })).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  test('si falta la tabla avisa UNA vez, no insiste, y reintenta pasado un rato', async () => {
    fake = crearSupabaseFalso({ errorEn: { tabla: 'chat_historial', op: 'select', mensaje: 'relation "chat_historial" does not exist' } });
    getSupabase.mockReturnValue(fake);

    expect(await servicio.cargar(7)).toBeNull();
    const consultas = () => fake.llamadas.filter(q => q.t === 'chat_historial').length;
    expect(consultas()).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    await servicio.cargar(7);
    await servicio.guardar(7, { mensajes: [], ultimoId: 0, rev: 0 });
    expect(consultas()).toBe(1); // no volvió a consultar
    expect(logger.warn).toHaveBeenCalledTimes(1);

    const ahora = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(ahora + servicio.REINTENTO_TABLA_MS + 1000);
    fake = crearSupabaseFalso(); // ya se creó la tabla
    getSupabase.mockReturnValue(fake);
    expect(await servicio.guardar(7, { mensajes: [msg(1, 'x')], ultimoId: 1, rev: 1 })).toBe(true);
    Date.now.mockRestore();
  });
});
