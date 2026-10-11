// /api/profesionales/registro: cada persona gestiona SU registro como profesional; el dueño, el de
// sus miembros (él y sus invitados) y de nadie más.

jest.mock('../src/config', () => ({}));
jest.mock('../src/lib/supabase', () => ({ isAvailable: jest.fn(() => true) }));
jest.mock('../src/services/agenda.service', () => ({ invalidarConsultorioMap: jest.fn() }));
jest.mock('../src/services/profesional.service', () => ({
  listarProfesionales: jest.fn(),
  registrarProfesional: jest.fn().mockResolvedValue({ ok: true }),
  eliminarProfesional: jest.fn().mockResolvedValue({ ok: true }),
  normalizarNombreProfesional: (s) => String(s || '').toLowerCase().replace(/^dra?\.\s*/, '').trim(),
}));

const express = require('express');
const { isAvailable } = require('../src/lib/supabase');
const agenda = require('../src/services/agenda.service');
const prof = require('../src/services/profesional.service');
const { registrarRutasProfesionales } = require('../src/api/profesionales.routes');

const DUENO = '1';
const INVITADO = '2';
const OTRO_INVITADO = '3';
const AJENO = '99'; // de otro consultorio

const authMiddleware = (req, res, next) => {
  const id = req.get('x-user');
  if (!id) return res.status(401).json({ error: 'No autorizado' });
  req.user = { userId: id };
  next();
};

let server, base;
let tenantDe;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registrarRutasProfesionales(app, {
    authMiddleware,
    esDuenoOAdmin: (id) => String(id) === DUENO,
    clientes: () => ({ [DUENO]: { usuarios: [Number(INVITADO), Number(OTRO_INVITADO)] } }),
    resolveTenantId: async (id) => tenantDe(String(id)),
  });
  await new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => {
  jest.clearAllMocks();
  isAvailable.mockReturnValue(true);
  tenantDe = () => 't1';
  prof.listarProfesionales.mockResolvedValue([
    { userId: INVITADO, nombre: 'Diego', consultorio: 'Consultorio 2' },
    { userId: '555', nombre: 'Ex miembro', consultorio: null },
  ]);
  prof.registrarProfesional.mockResolvedValue({ ok: true });
  prof.eliminarProfesional.mockResolvedValue({ ok: true });
});

const req = (method, path, user, body) => fetch(`${base}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...(user ? { 'x-user': user } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

describe('GET /api/profesionales/registro', () => {
  test('el dueño ve a todo su equipo, a los registrados aunque ya no sean miembros, y quién ya es profesional', async () => {
    const r = await req('GET', '/api/profesionales/registro', DUENO);
    expect(r.status).toBe(200);
    const { puedeGestionar, miembros } = await r.json();
    expect(puedeGestionar).toBe(true);
    expect(miembros.map(m => m.userId)).toEqual([DUENO, INVITADO, '555', OTRO_INVITADO]);
    expect(miembros[0]).toMatchObject({ esYo: true, etiqueta: 'Vos', profesional: null });
    expect(miembros.find(m => m.userId === INVITADO).profesional).toEqual({ nombre: 'Diego', consultorio: 'Consultorio 2' });
    expect(miembros.find(m => m.userId === OTRO_INVITADO).profesional).toBeNull();
  });

  test('un invitado ve solo lo suyo (no a sus compañeros)', async () => {
    const r = await req('GET', '/api/profesionales/registro', INVITADO);
    const { puedeGestionar, miembros } = await r.json();
    expect(puedeGestionar).toBe(false);
    expect(miembros).toHaveLength(1);
    expect(miembros[0]).toMatchObject({ userId: INVITADO, esYo: true, profesional: { nombre: 'Diego', consultorio: 'Consultorio 2' } });
  });

  test('sin Supabase o sin tenant: 503 con un mensaje claro', async () => {
    isAvailable.mockReturnValue(false);
    expect((await req('GET', '/api/profesionales/registro', DUENO)).status).toBe(503);
    isAvailable.mockReturnValue(true);
    tenantDe = () => null;
    expect((await req('GET', '/api/profesionales/registro', DUENO)).status).toBe(503);
  });

  test('sin sesión: 401', async () => {
    expect((await req('GET', '/api/profesionales/registro')).status).toBe(401);
  });
});

describe('PUT /api/profesionales/registro/:userId', () => {
  test('uno se registra a sí mismo, con el tenant de la sesión', async () => {
    const r = await req('PUT', '/api/profesionales/registro/yo', OTRO_INVITADO, { nombre: '  Dra. María López ', consultorio: 'Consultorio 3' });
    expect(r.status).toBe(200);
    expect(prof.registrarProfesional).toHaveBeenCalledWith('t1', OTRO_INVITADO, 'Dra. María López', 'Consultorio 3');
    expect(agenda.invalidarConsultorioMap).toHaveBeenCalledWith('t1');
    expect(await r.json()).toMatchObject({ ok: true, profesional: { userId: OTRO_INVITADO, nombre: 'Dra. María López', consultorio: 'Consultorio 3' } });
  });

  test.each([['ninguno'], [''], ['-']])('consultorio "%s" se guarda como sin consultorio', async (c) => {
    await req('PUT', '/api/profesionales/registro/yo', DUENO, { nombre: 'Laura', consultorio: c });
    expect(prof.registrarProfesional).toHaveBeenCalledWith('t1', DUENO, 'Laura', null);
  });

  test('el dueño registra a un miembro de su equipo', async () => {
    const r = await req('PUT', `/api/profesionales/registro/${OTRO_INVITADO}`, DUENO, { nombre: 'Ana', consultorio: '' });
    expect(r.status).toBe(200);
    expect(prof.registrarProfesional).toHaveBeenCalledWith('t1', OTRO_INVITADO, 'Ana', null);
  });

  test('un invitado NO puede registrar a otra persona', async () => {
    const r = await req('PUT', `/api/profesionales/registro/${OTRO_INVITADO}`, INVITADO, { nombre: 'Ana' });
    expect(r.status).toBe(403);
    expect(prof.registrarProfesional).not.toHaveBeenCalled();
  });

  test('el dueño NO puede registrar a alguien que no es de su consultorio', async () => {
    const r = await req('PUT', `/api/profesionales/registro/${AJENO}`, DUENO, { nombre: 'Intruso' });
    expect(r.status).toBe(404);
    expect(prof.registrarProfesional).not.toHaveBeenCalled();
  });

  test('nombre muy corto o vacío: 400', async () => {
    expect((await req('PUT', '/api/profesionales/registro/yo', DUENO, { nombre: 'A' })).status).toBe(400);
    expect((await req('PUT', '/api/profesionales/registro/yo', DUENO, { consultorio: 'X' })).status).toBe(400);
    expect(prof.registrarProfesional).not.toHaveBeenCalled();
  });

  test('un nombre que ya usa OTRO profesional se rechaza (el aviso le llegaría a quien no es)', async () => {
    const r = await req('PUT', '/api/profesionales/registro/yo', DUENO, { nombre: 'dra. diego' });
    expect(r.status).toBe(409);
    expect(prof.registrarProfesional).not.toHaveBeenCalled();
  });

  test('pero se puede cambiar el propio registro sin chocar consigo mismo', async () => {
    const r = await req('PUT', '/api/profesionales/registro/yo', INVITADO, { nombre: 'Diego', consultorio: 'Consultorio 5' });
    expect(r.status).toBe(200);
    expect(prof.registrarProfesional).toHaveBeenCalledWith('t1', INVITADO, 'Diego', 'Consultorio 5');
  });

  test('si falla guardar: 500 sin filtrar el motivo', async () => {
    prof.registrarProfesional.mockResolvedValueOnce({ ok: false, error: 'detalle interno de la base' });
    const r = await req('PUT', '/api/profesionales/registro/yo', DUENO, { nombre: 'Laura' });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/detalle interno/);
    expect(agenda.invalidarConsultorioMap).not.toHaveBeenCalled();
  });

  test('sin Supabase: 503', async () => {
    isAvailable.mockReturnValue(false);
    expect((await req('PUT', '/api/profesionales/registro/yo', DUENO, { nombre: 'Laura' })).status).toBe(503);
  });

  test('sin sesión: 401', async () => {
    expect((await req('PUT', '/api/profesionales/registro/yo', null, { nombre: 'Laura' })).status).toBe(401);
  });
});

describe('DELETE /api/profesionales/registro/:userId', () => {
  test('uno se da de baja a sí mismo', async () => {
    const r = await req('DELETE', '/api/profesionales/registro/yo', INVITADO);
    expect(r.status).toBe(200);
    expect(prof.eliminarProfesional).toHaveBeenCalledWith('t1', INVITADO);
    expect(agenda.invalidarConsultorioMap).toHaveBeenCalledWith('t1');
  });

  test('el dueño da de baja a un miembro; un invitado no puede dar de baja a otro', async () => {
    expect((await req('DELETE', `/api/profesionales/registro/${INVITADO}`, DUENO)).status).toBe(200);
    expect(prof.eliminarProfesional).toHaveBeenLastCalledWith('t1', INVITADO);

    prof.eliminarProfesional.mockClear();
    expect((await req('DELETE', `/api/profesionales/registro/${INVITADO}`, OTRO_INVITADO)).status).toBe(403);
    expect((await req('DELETE', `/api/profesionales/registro/${AJENO}`, DUENO)).status).toBe(404);
    expect(prof.eliminarProfesional).not.toHaveBeenCalled();
  });
});
