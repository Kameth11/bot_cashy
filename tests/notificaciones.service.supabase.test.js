// Notificaciones por el camino REAL de Supabase: forPersona + forTenant verdaderos sobre un
// Supabase falso en memoria. tests/notificaciones.service.test.js resuelve el tenant en null y
// por eso solo ejercita el modo memoria: un error de configuración de tablas (como que
// 'notificaciones' faltara en SCOPED_TABLES) pasaba todos los tests y rompía en producción,
// porque el servicio atrapa el error y cae a memoria sin avisar. Acá se verifica que de verdad
// se escribe y se lee en las tablas de Supabase.

jest.mock('../src/config', () => ({}));
jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn(() => true) }));
jest.mock('../src/services/db.service', () => ({ ensureProfile: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn().mockResolvedValue('t1') }));
jest.mock('../src/services/profesional.service', () => ({ buscarProfesionalPorNombre: jest.fn() }));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn().mockResolvedValue({}) }));

const { getSupabase } = require('../src/lib/supabase');
const logger = require('../src/lib/logger');
const webpush = require('web-push');
const { crearSupabaseFalso } = require('./helpers/fake-supabase');
const svc = require('../src/services/notificaciones.service');

const SUB = { endpoint: 'https://push.example/abc', keys: { p256dh: 'P256', auth: 'AUTH' } };
const AVISO = { tipo: 'turno_nuevo', titulo: '🗓 Turno nuevo', cuerpo: 'Juan · 10:30', url: '/agenda' };

let fake;
beforeEach(() => {
  jest.clearAllMocks();
  svc._memoria.clear();
  fake = crearSupabaseFalso({ defaults: { notificaciones: { leida: false } } });
  // El falso fecha las filas en enero de 2026; el servicio lista solo los últimos días.
  jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 0, 2).getTime());
  getSupabase.mockReturnValue(fake);
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  process.env.VAPID_SUBJECT = 'mailto:a@b.com';
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

const tablasConsultadas = () => new Set(fake.llamadas.map(q => q.t));
const noHuboFallos = () => {
  expect(logger.warn).not.toHaveBeenCalledWith('NOTIF', expect.stringContaining('No se pudo preparar'), expect.anything());
  expect(logger.warn).not.toHaveBeenCalledWith('NOTIF', expect.stringContaining('Error de Supabase'), expect.anything());
};

describe('notificaciones con Supabase (no memoria)', () => {
  test('notificar guarda el aviso en la tabla notificaciones de ESA persona, y listar lo lee de ahí', async () => {
    const r = await svc.notificar(10, AVISO);
    expect(r.ok).toBe(true);

    expect(fake.tablas.notificaciones).toHaveLength(1);
    expect(fake.tablas.notificaciones[0]).toMatchObject({ tenant_id: 't1', user_id: 10, tipo: 'turno_nuevo' });
    expect(svc._memoria.get('10')?.notificaciones || []).toHaveLength(0); // no cayó a memoria

    const { notificaciones, noLeidas } = await svc.listar(10);
    expect(notificaciones).toHaveLength(1);
    expect(noLeidas).toBe(1);
    noHuboFallos();
  });

  test('otra persona del mismo consultorio no ve los avisos ajenos', async () => {
    await svc.notificar(10, AVISO);
    const { notificaciones } = await svc.listar(11);
    expect(notificaciones).toHaveLength(0);
  });

  test('marcarLeidas actualiza la tabla', async () => {
    await svc.notificar(10, AVISO);
    await svc.marcarLeidas(10);
    expect(fake.tablas.notificaciones[0].leida).toBe(true);
    noHuboFallos();
  });

  test('la suscripción push se guarda en push_subscriptions y notificar la usa para mandar el push', async () => {
    await svc.guardarSuscripcion(10, SUB, 'iPhone');
    expect(fake.tablas.push_subscriptions).toHaveLength(1);
    expect(fake.tablas.push_subscriptions[0]).toMatchObject({ tenant_id: 't1', user_id: 10, endpoint: SUB.endpoint });

    const r = await svc.notificar(10, AVISO);
    expect(r.push).toBe(1);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    noHuboFallos();
  });

  test('se consultan las dos tablas (si faltara una en SCOPED_TABLES, esto fallaría)', async () => {
    await svc.guardarSuscripcion(10, SUB);
    await svc.notificar(10, AVISO);
    await svc.listar(10);
    expect(tablasConsultadas()).toEqual(new Set(['notificaciones', 'push_subscriptions']));
  });
});
