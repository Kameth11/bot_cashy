// /api/invitaciones: la forma del pedido, los códigos de error y qué permisos se ofrecen a quien invita.
// Las reglas de fondo (escalada de privilegios, un solo uso...) las cubre invitacion-web.service.test.js.

jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }));
jest.mock('../src/auth', () => ({ resolverPermisos: jest.fn() }));
jest.mock('../src/services/invitacion-web.service', () => ({
  PERMISO_INVITAR: 'invitar_personas',
  DIAS_DE_VIGENCIA: 7,
  listarInvitaciones: jest.fn(),
  crearInvitacion: jest.fn(),
  revocarInvitacion: jest.fn(),
}));

const express = require('express');
const { resolverPermisos } = require('../src/auth');
const { PERMISOS } = require('../src/auth/permisos');
const svc = require('../src/services/invitacion-web.service');
const { registrarRutasInvitaciones } = require('../src/api/invitaciones.routes');

const DUENO = '1';
const SECRE = '2';

const permisosDe = {
  [DUENO]: PERMISOS,
  [SECRE]: ['ver_agenda', 'editar_agenda', 'invitar_personas'],
  3: ['ver_agenda'],
};

const authMiddleware = (req, res, next) => {
  const id = req.get('x-user');
  if (!id) return res.status(401).json({ error: 'No autorizado' });
  req.user = { userId: id };
  next();
};
// Mismo comportamiento que el real: 403 si la sesión no tiene el permiso.
const requierePermiso = (permiso) => (req, res, next) => (
  resolverPermisos(req.user.userId).includes(permiso) ? next() : res.status(403).json({ error: 'No tenés permiso para esta acción' })
);
let bloquearRate = false;
const rateLimit = () => (req, res, next) => (bloquearRate ? res.status(429).json({ error: 'Demasiados intentos' }) : next());

let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registrarRutasInvitaciones(app, {
    authMiddleware, requierePermiso, rateLimit, limitador: () => ({ allowed: true }),
    esDuenoOAdmin: (id) => String(id) === DUENO,
    dashboardUrl: () => 'https://cashy.example',
  });
  await new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => {
  jest.clearAllMocks();
  bloquearRate = false;
  resolverPermisos.mockImplementation((id) => permisosDe[String(id)] || ['ver_agenda']);
  svc.listarInvitaciones.mockResolvedValue({ ok: true, invitaciones: [{ id: 'i1', email: 'a@b.com' }] });
  svc.crearInvitacion.mockResolvedValue({ ok: true, invitacion: { id: 'i2', email: 'x@y.com' } });
  svc.revocarInvitacion.mockResolvedValue({ ok: true });
});

const req = (method, path, user, body) => fetch(`${base}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...(user ? { 'x-user': user } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

describe('GET /api/invitaciones', () => {
  test('el dueño ve la lista y puede dar todos los permisos, incluido el de invitar', async () => {
    const r = await req('GET', '/api/invitaciones', DUENO);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.invitaciones).toHaveLength(1);
    expect(b.puedeDelegar).toBe(true);
    expect(b.permisosDisponibles).toEqual(PERMISOS);
    expect(b.vigenciaDias).toBe(7);
    expect(b.urlIngreso).toBe('https://cashy.example');
  });

  test('la secretaria solo puede ofrecer lo que ella tiene, y nunca el permiso de invitar', async () => {
    const b = await (await req('GET', '/api/invitaciones', SECRE)).json();
    expect(b.puedeDelegar).toBe(false);
    expect(b.permisosDisponibles).toEqual(['ver_agenda', 'editar_agenda']);
    // Solo las plantillas que puede dar completas: "odontólogo" sí; "recepción" y "contadora" no.
    expect(Object.keys(b.presets)).toEqual(['odontologo']);
  });

  test('el dueño ve todas las plantillas', async () => {
    const b = await (await req('GET', '/api/invitaciones', DUENO)).json();
    expect(Object.keys(b.presets).sort()).toEqual(['contadora', 'odontologo', 'recepcion']);
  });

  test('sin el permiso invitar_personas: 403 y no llega al servicio', async () => {
    expect((await req('GET', '/api/invitaciones', '3')).status).toBe(403);
    expect(svc.listarInvitaciones).not.toHaveBeenCalled();
  });

  test('sin sesión: 401', async () => {
    expect((await req('GET', '/api/invitaciones')).status).toBe(401);
  });
});

describe('POST /api/invitaciones', () => {
  test('crea con el actor de la sesión (ignora un "creadaPor"/"ownerId" del body)', async () => {
    const r = await req('POST', '/api/invitaciones', SECRE, {
      email: 'x@y.com', permisos: ['ver_agenda'], profesional: { nombre: 'Ana', consultorio: 'C1' }, creadaPor: '1', ownerId: '99',
    });
    expect(r.status).toBe(201);
    expect(svc.crearInvitacion).toHaveBeenCalledWith(SECRE, { email: 'x@y.com', permisos: ['ver_agenda'], profesional: { nombre: 'Ana', consultorio: 'C1' } });
    expect(await r.json()).toMatchObject({ ok: true, urlIngreso: 'https://cashy.example' });
  });

  test.each([
    ['sin_base', 503],
    ['sin_permiso', 403],
    ['email_invalido', 400],
    ['permisos_invalidos', 400],
    ['permisos_excedidos', 403],
    ['delegacion_no_permitida', 403],
    ['limite_pendientes', 409],
    ['ya_miembro', 409],
    ['ya_invitado', 409],
    ['profesional_nombre_invalido', 400],
    ['profesional_duplicado', 409],
  ])('el error %s responde %i con un mensaje legible', async (error, status) => {
    svc.crearInvitacion.mockResolvedValueOnce({ ok: false, error });
    const r = await req('POST', '/api/invitaciones', DUENO, { email: 'x@y.com' });
    expect(r.status).toBe(status);
    expect((await r.json()).error).toMatch(/\w{4}/);
  });

  test('un error desconocido responde 500 sin filtrar el motivo', async () => {
    svc.crearInvitacion.mockResolvedValueOnce({ ok: false, error: 'detalle_interno_de_la_base' });
    const r = await req('POST', '/api/invitaciones', DUENO, { email: 'x@y.com' });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/detalle_interno/);
  });

  test('con el límite de pedidos superado: 429', async () => {
    bloquearRate = true;
    expect((await req('POST', '/api/invitaciones', DUENO, { email: 'x@y.com' })).status).toBe(429);
    expect(svc.crearInvitacion).not.toHaveBeenCalled();
  });

  test('sin el permiso: 403', async () => {
    expect((await req('POST', '/api/invitaciones', '3', { email: 'x@y.com' })).status).toBe(403);
    expect(svc.crearInvitacion).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/invitaciones/:id', () => {
  test('revoca con el actor de la sesión', async () => {
    const r = await req('DELETE', '/api/invitaciones/abc', SECRE);
    expect(r.status).toBe(200);
    expect(svc.revocarInvitacion).toHaveBeenCalledWith(SECRE, 'abc');
  });

  test('si no existe o no es suya: 404', async () => {
    svc.revocarInvitacion.mockResolvedValueOnce({ ok: false, error: 'no_encontrada' });
    expect((await req('DELETE', '/api/invitaciones/abc', SECRE)).status).toBe(404);
  });

  test('sin el permiso: 403', async () => {
    expect((await req('DELETE', '/api/invitaciones/abc', '3')).status).toBe(403);
    expect(svc.revocarInvitacion).not.toHaveBeenCalled();
  });
});
