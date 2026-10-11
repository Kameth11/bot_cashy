// Rutas /api/notificaciones/*: cada persona toca SOLO lo suyo (el userId sale de la sesión).

jest.mock('../src/config', () => ({}));
jest.mock('../src/services/notificaciones.service', () => ({
  listar: jest.fn(),
  marcarLeidas: jest.fn().mockResolvedValue(undefined),
  guardarSuscripcion: jest.fn().mockResolvedValue(undefined),
  borrarSuscripcion: jest.fn().mockResolvedValue(undefined),
  pushDisponible: jest.fn(),
  clavePublica: jest.fn(),
}));

const express = require('express');
const svc = require('../src/services/notificaciones.service');
const { registrarRutasNotificaciones } = require('../src/api/notificaciones.routes');

// Auth de prueba: el "usuario" viene en un header; sin header, 401.
const authMiddleware = (req, res, next) => {
  const id = req.get('x-user');
  if (!id) return res.status(401).json({ error: 'No autorizado' });
  req.user = { userId: id };
  next();
};

let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registrarRutasNotificaciones(app, { authMiddleware });
  await new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => {
  jest.clearAllMocks();
  svc.listar.mockResolvedValue({ notificaciones: [{ id: 'n1', titulo: 'Hola' }], noLeidas: 1 });
  svc.pushDisponible.mockReturnValue(true);
  svc.clavePublica.mockReturnValue('PUB');
});

const req = (method, path, user, body) => fetch(`${base}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...(user ? { 'x-user': user } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

describe('GET /api/notificaciones', () => {
  test('devuelve la lista de la sesión y si hay push', async () => {
    const r = await req('GET', '/api/notificaciones', '77');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ notificaciones: [{ id: 'n1', titulo: 'Hola' }], noLeidas: 1, push: { disponible: true, clavePublica: 'PUB' } });
    expect(svc.listar).toHaveBeenCalledWith('77');
  });

  test('sin sesión: 401 y no toca nada', async () => {
    expect((await req('GET', '/api/notificaciones')).status).toBe(401);
    expect(svc.listar).not.toHaveBeenCalled();
  });

  test('un error del servicio responde 500 sin filtrar el motivo', async () => {
    svc.listar.mockRejectedValueOnce(new Error('detalle interno'));
    const r = await req('GET', '/api/notificaciones', '77');
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/detalle interno/);
  });
});

describe('POST /api/notificaciones/leidas', () => {
  test('marca las de la sesión (ignora un userId del body)', async () => {
    const r = await req('POST', '/api/notificaciones/leidas', '77', { userId: '99' });
    expect(r.status).toBe(200);
    expect(svc.marcarLeidas).toHaveBeenCalledWith('77');
  });
});

describe('suscripción push', () => {
  const sub = { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } };

  test('guarda la suscripción de la sesión', async () => {
    const r = await req('POST', '/api/notificaciones/suscripcion', '77', { suscripcion: sub, userId: '99' });
    expect(r.status).toBe(201);
    expect(svc.guardarSuscripcion).toHaveBeenCalledWith('77', sub, expect.any(String));
  });

  test('sin claves VAPID en el servidor: 503', async () => {
    svc.pushDisponible.mockReturnValue(false);
    expect((await req('POST', '/api/notificaciones/suscripcion', '77', { suscripcion: sub })).status).toBe(503);
    expect(svc.guardarSuscripcion).not.toHaveBeenCalled();
  });

  test('suscripción inválida: 400', async () => {
    svc.guardarSuscripcion.mockRejectedValueOnce(new Error('suscripcion_invalida'));
    expect((await req('POST', '/api/notificaciones/suscripcion', '77', { suscripcion: { endpoint: 'x' } })).status).toBe(400);
  });

  test('borra por endpoint, de la persona de la sesión', async () => {
    const r = await req('DELETE', '/api/notificaciones/suscripcion', '77', { endpoint: sub.endpoint });
    expect(r.status).toBe(200);
    expect(svc.borrarSuscripcion).toHaveBeenCalledWith('77', sub.endpoint);
  });

  test('sin sesión: 401', async () => {
    expect((await req('POST', '/api/notificaciones/suscripcion', null, { suscripcion: sub })).status).toBe(401);
    expect((await req('DELETE', '/api/notificaciones/suscripcion', null, { endpoint: 'x' })).status).toBe(401);
  });
});
