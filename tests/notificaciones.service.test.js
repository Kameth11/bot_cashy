// Notificaciones web: campanita (SSE + lista) y Web Push. Sin Supabase (modo memoria):
// lo de Supabase lo cubre forPersona en tests/lib.persona-db.test.js.

jest.mock('../src/config', () => ({}));
jest.mock('../src/services/db.service', () => ({ ensureProfile: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn().mockResolvedValue(null) }));
jest.mock('../src/services/profesional.service', () => ({ buscarProfesionalPorNombre: jest.fn() }));
jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn().mockResolvedValue({}) }));

const webpush = require('web-push');
const { resolveTenantId } = require('../src/services/tenant.service');
const { buscarProfesionalPorNombre } = require('../src/services/profesional.service');
const events = require('../src/services/events.service');
const svc = require('../src/services/notificaciones.service');

const SUB = { endpoint: 'https://push.example/abc', keys: { p256dh: 'P256', auth: 'AUTH' } };
const AVISO = { tipo: 'turno_nuevo', titulo: '🗓 Turno nuevo', cuerpo: 'Juan · 10:30', url: '/agenda' };

function conVapid() {
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  process.env.VAPID_SUBJECT = 'mailto:a@b.com';
}
function sinVapid() {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
}

beforeEach(() => {
  jest.clearAllMocks();
  svc._memoria.clear();
  resolveTenantId.mockResolvedValue(null);
  webpush.sendNotification.mockResolvedValue({});
  sinVapid();
});

describe('notificar + listar + marcarLeidas', () => {
  test('guarda el aviso, lo muestra en la lista y lo marca como leído', async () => {
    const r = await svc.notificar(10, AVISO);
    expect(r.ok).toBe(true);
    let { notificaciones, noLeidas } = await svc.listar(10);
    expect(notificaciones).toHaveLength(1);
    expect(notificaciones[0]).toMatchObject({ tipo: 'turno_nuevo', titulo: '🗓 Turno nuevo', cuerpo: 'Juan · 10:30', url: '/agenda', leida: false });
    expect(noLeidas).toBe(1);

    await svc.marcarLeidas(10);
    ({ notificaciones, noLeidas } = await svc.listar(10));
    expect(noLeidas).toBe(0);
    expect(notificaciones[0].leida).toBe(true);
  });

  test('cada persona ve solo lo suyo', async () => {
    await svc.notificar(10, AVISO);
    await svc.notificar(20, { ...AVISO, titulo: 'Otro' });
    expect((await svc.listar(10)).notificaciones.map(n => n.titulo)).toEqual(['🗓 Turno nuevo']);
    expect((await svc.listar(20)).notificaciones.map(n => n.titulo)).toEqual(['Otro']);
    expect((await svc.listar(30)).notificaciones).toEqual([]);
  });

  test('la más nueva va primero y la lista tiene tope', async () => {
    for (let i = 0; i < 40; i++) await svc.notificar(10, { ...AVISO, titulo: `n${i}` });
    const { notificaciones } = await svc.listar(10);
    expect(notificaciones).toHaveLength(30);
    expect(notificaciones[0].titulo).toBe('n39');
  });

  test('rechaza un aviso inválido sin lanzar', async () => {
    expect((await svc.notificar(10, { tipo: 'inventado', titulo: 'x' })).ok).toBe(false);
    expect((await svc.notificar(10, { tipo: 'turno_nuevo' })).ok).toBe(false);
    expect((await svc.notificar(null, AVISO)).ok).toBe(false);
    expect((await svc.listar(10)).notificaciones).toEqual([]);
  });

  test('manda el evento SSE `notificacion` a las pestañas abiertas de esa persona', async () => {
    const res10 = { write: jest.fn() };
    const res20 = { write: jest.fn() };
    events.subscribe(10, res10);
    events.subscribe(20, res20);
    const r = await svc.notificar(10, AVISO);
    expect(r.web).toBe(1);
    expect(res10.write).toHaveBeenCalledTimes(1);
    expect(res10.write.mock.calls[0][0]).toMatch(/^event: notificacion\ndata: \{.*"titulo":"🗓 Turno nuevo".*\}\n\n$/);
    expect(res20.write).not.toHaveBeenCalled();
    events.unsubscribe(10, res10);
    events.unsubscribe(20, res20);
  });
});

describe('Web Push', () => {
  test('sin claves VAPID no hay push y no se ofrece', async () => {
    expect(svc.pushDisponible()).toBe(false);
    expect(svc.clavePublica()).toBeNull();
    await svc.guardarSuscripcion(10, SUB);
    const r = await svc.notificar(10, AVISO);
    expect(r.push).toBe(0);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  test('con claves manda el push a cada dispositivo de la persona (y a nadie más)', async () => {
    conVapid();
    expect(svc.pushDisponible()).toBe(true);
    expect(svc.clavePublica()).toBe('pub');
    await svc.guardarSuscripcion(10, SUB);
    await svc.guardarSuscripcion(10, { ...SUB, endpoint: 'https://push.example/def' });
    await svc.guardarSuscripcion(20, { ...SUB, endpoint: 'https://push.example/otro' });

    const r = await svc.notificar(10, AVISO);
    expect(r.push).toBe(2);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    const destinos = webpush.sendNotification.mock.calls.map(c => c[0].endpoint).sort();
    expect(destinos).toEqual(['https://push.example/abc', 'https://push.example/def']);
    expect(JSON.parse(webpush.sendNotification.mock.calls[0][1])).toMatchObject({ titulo: '🗓 Turno nuevo', cuerpo: 'Juan · 10:30', url: '/agenda', tag: 'turno_nuevo' });
  });

  test('un dispositivo que ya no existe (410) se borra solo', async () => {
    conVapid();
    await svc.guardarSuscripcion(10, SUB);
    webpush.sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    const r = await svc.notificar(10, AVISO);
    expect(r.ok).toBe(true);
    expect(r.push).toBe(0);
    await svc.notificar(10, AVISO);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1); // la segunda vez ya no hay a quién mandarle
  });

  test('un error de red al mandar el push no rompe el aviso', async () => {
    conVapid();
    await svc.guardarSuscripcion(10, SUB);
    webpush.sendNotification.mockRejectedValueOnce(Object.assign(new Error('timeout'), { statusCode: 500 }));
    expect((await svc.notificar(10, AVISO)).ok).toBe(true);
    expect((await svc.listar(10)).notificaciones).toHaveLength(1);
  });

  test('borrarSuscripcion deja de mandarle a ese dispositivo', async () => {
    conVapid();
    await svc.guardarSuscripcion(10, SUB);
    await svc.borrarSuscripcion(10, SUB.endpoint);
    expect((await svc.notificar(10, AVISO)).push).toBe(0);
  });

  test('una suscripción inválida se rechaza', async () => {
    await expect(svc.guardarSuscripcion(10, { endpoint: 'http://inseguro', keys: { p256dh: 'a', auth: 'b' } })).rejects.toThrow('suscripcion_invalida');
    await expect(svc.guardarSuscripcion(10, { endpoint: 'https://x', keys: {} })).rejects.toThrow('suscripcion_invalida');
    await expect(svc.guardarSuscripcion(10, null)).rejects.toThrow('suscripcion_invalida');
  });

  test('el mismo dispositivo registrado dos veces cuenta una sola vez', async () => {
    conVapid();
    await svc.guardarSuscripcion(10, SUB);
    await svc.guardarSuscripcion(10, SUB);
    expect((await svc.notificar(10, AVISO)).push).toBe(1);
  });
});

describe('notificarTurno (aviso al profesional del turno)', () => {
  const turno = { cliente: 'Juan', hora: '10:30', servicio: 'Limpieza', profesional: 'Dr. Pérez' };

  beforeEach(() => {
    resolveTenantId.mockResolvedValue('t1');
    buscarProfesionalPorNombre.mockResolvedValue({ nombre: 'Dr. Pérez', telegram_user_id: 555 });
  });

  test('avisa al profesional con el detalle del turno', async () => {
    const r = await svc.notificarTurno(10, 'llegada_paciente', turno);
    expect(r.ok).toBe(true);
    expect(buscarProfesionalPorNombre).toHaveBeenCalledWith('t1', 'Dr. Pérez');
    const { notificaciones } = await svc.listar(555);
    expect(notificaciones[0]).toMatchObject({ tipo: 'llegada_paciente', titulo: '✅ Llegó tu paciente', cuerpo: 'Juan · 10:30 · Limpieza', url: '/agenda' });
    expect((await svc.listar(10)).notificaciones).toEqual([]);
  });

  test.each([
    ['turno_nuevo', '🗓 Turno nuevo'],
    ['turno_cancelado', '❌ Turno cancelado'],
    ['turno_no_vino', '🚫 El paciente no vino'],
  ])('%s', async (tipo, titulo) => {
    await svc.notificarTurno(10, tipo, turno);
    expect((await svc.listar(555)).notificaciones[0].titulo).toBe(titulo);
  });

  test('no se avisa a quien hizo el cambio', async () => {
    const r = await svc.notificarTurno(555, 'turno_nuevo', turno);
    expect(r).toMatchObject({ ok: true, omitido: 'es_quien_lo_hizo' });
    expect((await svc.listar(555)).notificaciones).toEqual([]);
  });

  test('sin profesional, profesional no registrado o sin tenant: no avisa y no lanza', async () => {
    expect((await svc.notificarTurno(10, 'turno_nuevo', { ...turno, profesional: '' })).ok).toBe(false);

    buscarProfesionalPorNombre.mockResolvedValueOnce(null);
    expect((await svc.notificarTurno(10, 'turno_nuevo', turno)).error).toBe('profesional_no_encontrado');

    resolveTenantId.mockResolvedValueOnce(null);
    expect((await svc.notificarTurno(10, 'turno_nuevo', turno)).error).toBe('tenant_no_resuelto');

    buscarProfesionalPorNombre.mockRejectedValueOnce(new Error('boom'));
    expect((await svc.notificarTurno(10, 'turno_nuevo', turno)).ok).toBe(false);
  });
});
