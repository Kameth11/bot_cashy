// Invitaciones por email (alta sin Telegram). Se prueba con un Supabase falso en memoria que
// respeta lo que importa: filtros eq/lt/gt, UPDATE condicional (un solo uso) y el índice único
// de "una pendiente por email y consultorio".

jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }));
jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1,
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  USE_SUPABASE: true,
}));
jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn() }));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn() }));
jest.mock('../src/services/agenda.service', () => ({ invalidarConsultorioMap: jest.fn() }));
jest.mock('../src/services/profesional.service', () => ({
  listarProfesionales: jest.fn(),
  registrarProfesional: jest.fn(),
  normalizarNombreProfesional: (s) => String(s || '').toLowerCase().trim(),
}));
jest.mock('../src/services/cliente.service', () => ({
  clientes: {},
  googleSoportado: jest.fn(() => true),
  guardarClientes: jest.fn(async () => {}),
}));

const supabase = require('../src/lib/supabase');
const clienteService = require('../src/services/cliente.service');
const { resolveTenantId } = require('../src/services/tenant.service');
const profesionales = require('../src/services/profesional.service');
const agenda = require('../src/services/agenda.service');
const { obtenerClientePorUserId, resolverPermisos } = require('../src/auth');
const svc = require('../src/services/invitacion-web.service');

// ── Supabase falso (solo lo que usa el servicio) ─────────────────────────────
function crearBaseFalsa() {
  const filas = [];
  let seq = 1;
  const from = (tabla) => {
    if (tabla !== 'invitaciones_web') throw new Error(`tabla inesperada: ${tabla}`);
    const q = { op: 'select', filtros: [], patch: null, fila: null, devolver: false, unico: false, head: false, orden: null, tope: null };
    const b = {
      select(_cols, opts = {}) { if (q.op !== 'select') q.devolver = true; if (opts.head) q.head = true; return b; },
      insert(fila) { q.op = 'insert'; q.fila = fila; return b; },
      update(patch) { q.op = 'update'; q.patch = patch; return b; },
      eq(col, val) { q.filtros.push(r => r[col] === val); return b; },
      lt(col, val) { q.filtros.push(r => r[col] < val); return b; },
      gt(col, val) { q.filtros.push(r => r[col] > val); return b; },
      order(col, { ascending = true } = {}) { q.orden = [col, ascending]; return b; },
      limit(n) { q.tope = n; return b; },
      single() { q.unico = true; return b; },
      then(res, rej) { return Promise.resolve(ejecutar()).then(res, rej); },
    };
    const ejecutar = () => {
      const coincide = r => q.filtros.every(f => f(r));
      if (q.op === 'insert') {
        const repetida = filas.some(r => r.tenant_id === q.fila.tenant_id && r.email === q.fila.email && r.estado === 'pendiente');
        if (repetida) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        const fila = { id: `inv${seq++}`, estado: 'pendiente', usada_por: null, usada_en: null, created_at: new Date(Date.now() + seq).toISOString(), ...q.fila };
        filas.push(fila);
        return { data: q.unico ? { ...fila } : [{ ...fila }], error: null };
      }
      if (q.op === 'update') {
        const tocadas = filas.filter(coincide);
        tocadas.forEach(r => Object.assign(r, q.patch));
        return { data: q.devolver ? tocadas.map(r => ({ ...r })) : null, error: null };
      }
      let hit = filas.filter(coincide);
      if (q.head) return { data: null, count: hit.length, error: null };
      if (q.orden) hit = [...hit].sort((x, y) => (x[q.orden[0]] < y[q.orden[0]] ? -1 : 1) * (q.orden[1] ? 1 : -1));
      if (q.tope) hit = hit.slice(0, q.tope);
      return { data: hit.map(r => ({ ...r })), error: null };
    };
    return b;
  };
  return { filas, from };
}

const DUENO = 1;        // dueño (y admin original)
const SECRE = 2;        // invitada con invitar_personas, pero no con todo
const MEDICO = 3;       // invitado sin permiso de invitar
const OTRO_DUENO = 50;  // otro consultorio

let base;
let tenantDe;

beforeEach(() => {
  jest.clearAllMocks();
  base = crearBaseFalsa();
  supabase.getSupabase.mockReturnValue(base);
  supabase.isAvailable.mockReturnValue(true);
  tenantDe = (id) => (Number(id) === OTRO_DUENO ? 't2' : 't1');
  resolveTenantId.mockImplementation(async (id) => tenantDe(id));
  profesionales.listarProfesionales.mockResolvedValue([{ userId: '3', nombre: 'Diego', consultorio: null }]);
  profesionales.registrarProfesional.mockResolvedValue({ ok: true });
  clienteService.googleSoportado.mockReturnValue(true);
  clienteService.guardarClientes.mockImplementation(async () => {});
  clienteService.clientes = {
    1: {
      email: 'owner@clinica.com', sheetId: 'S1', usuarios: [SECRE, MEDICO],
      permisos: {
        2: ['ver_agenda', 'editar_agenda', 'ver_movimientos', 'invitar_personas'],
        3: ['ver_agenda'],
      },
    },
    50: { email: 'otro@otra.com', sheetId: 'S2', usuarios: [], permisos: {} },
  };
});

const invitar = (actor, datos) => svc.crearInvitacion(actor, { email: 'nuevo@gmail.com', ...datos });

describe('crearInvitacion: quién puede y qué puede dar', () => {
  test('el dueño invita con permisos elegidos; vence a los 7 días', async () => {
    const r = await invitar(DUENO, { permisos: ['ver_agenda', 'editar_agenda'] });
    expect(r.ok).toBe(true);
    expect(r.invitacion).toMatchObject({ email: 'nuevo@gmail.com', permisos: ['ver_agenda', 'editar_agenda'], estado: 'pendiente', esMia: true });
    const dias = (new Date(r.invitacion.expiraEn).getTime() - Date.now()) / 86400000;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);
    expect(base.filas[0]).toMatchObject({ tenant_id: 't1', owner_id: 1, creada_por: 1 });
  });

  test('sin permisos elegidos recibe el mínimo, y el email se guarda en minúsculas', async () => {
    const r = await svc.crearInvitacion(DUENO, { email: '  Nuevo@Gmail.COM ' });
    expect(r.invitacion.permisos).toEqual(['ver_agenda']);
    expect(r.invitacion.email).toBe('nuevo@gmail.com');
  });

  test('quien no tiene el permiso invitar_personas no puede', async () => {
    expect((await invitar(MEDICO, {})).error).toBe('sin_permiso');
    expect((await invitar(999, {})).error).toBe('sin_permiso'); // ni siquiera es de ningún consultorio
    expect(base.filas).toHaveLength(0);
  });

  test('la secretaria con permiso invita, dando solo permisos que ella tiene', async () => {
    const r = await invitar(SECRE, { permisos: ['ver_agenda', 'editar_agenda'] });
    expect(r.ok).toBe(true);
    expect(base.filas[0]).toMatchObject({ owner_id: 1, creada_por: 2 }); // la cuenta queda en el consultorio del DUEÑO
  });

  test('NO se puede escalar privilegio: no dar lo que uno no tiene', async () => {
    expect((await invitar(SECRE, { permisos: ['ver_agenda', 'ver_balance'] })).error).toBe('permisos_excedidos');
    expect((await invitar(SECRE, { permisos: ['editar_movimientos'] })).error).toBe('permisos_excedidos');
    expect(base.filas).toHaveLength(0);
  });

  test('la delegación de invitar solo la da el dueño (no se encadena)', async () => {
    expect((await invitar(SECRE, { permisos: ['ver_agenda', 'invitar_personas'] })).error).toBe('delegacion_no_permitida');
    expect((await invitar(DUENO, { permisos: ['ver_agenda', 'invitar_personas'] })).ok).toBe(true);
  });

  test('permisos inventados o email inválido se rechazan', async () => {
    expect((await invitar(DUENO, { permisos: ['ser_dios'] })).error).toBe('permisos_invalidos');
    expect((await invitar(DUENO, { permisos: 'ver_agenda' })).ok).toBe(true); // no es array: se ignora y queda el mínimo
    expect((await svc.crearInvitacion(DUENO, { email: 'no-es-un-email' })).error).toBe('email_invalido');
    expect((await svc.crearInvitacion(DUENO, {})).error).toBe('email_invalido');
  });

  test('no se invita a alguien que ya es del consultorio', async () => {
    clienteService.clientes[String(MEDICO)] = { email: 'medico@clinica.com' };
    expect((await svc.crearInvitacion(DUENO, { email: 'MEDICO@clinica.com' })).error).toBe('ya_miembro');
    expect((await svc.crearInvitacion(DUENO, { email: 'owner@clinica.com' })).error).toBe('ya_miembro');
  });

  test('una sola pendiente por email; una vencida no bloquea la nueva', async () => {
    expect((await invitar(DUENO, {})).ok).toBe(true);
    expect((await invitar(DUENO, {})).error).toBe('ya_invitado');

    base.filas[0].expira_en = new Date(Date.now() - 1000).toISOString();
    const r = await invitar(DUENO, {});
    expect(r.ok).toBe(true);
    expect(base.filas.find(f => f.id === 'inv1').estado).toBe('revocada');
  });

  test('tope de invitaciones pendientes por consultorio', async () => {
    for (let i = 0; i < svc.MAX_PENDIENTES; i++) {
      expect((await svc.crearInvitacion(DUENO, { email: `p${i}@gmail.com` })).ok).toBe(true);
    }
    expect((await svc.crearInvitacion(DUENO, { email: 'una-mas@gmail.com' })).error).toBe('limite_pendientes');
    // el tope es por consultorio: el otro puede invitar
    expect((await svc.crearInvitacion(OTRO_DUENO, { email: 'x@gmail.com' })).ok).toBe(true);
  });

  test('profesional: nombre obligatorio si se pide y no puede repetir a uno ya registrado', async () => {
    expect((await invitar(DUENO, { profesional: { nombre: 'A' } })).error).toBe('profesional_nombre_invalido');
    expect((await invitar(DUENO, { profesional: { nombre: ' diego ' } })).error).toBe('profesional_duplicado');
    const r = await invitar(DUENO, { profesional: { nombre: 'Dra. Paula', consultorio: 'ninguno' } });
    expect(r.invitacion.profesional).toEqual({ nombre: 'Dra. Paula', consultorio: null });
  });

  test('sin Supabase no ofrece invitar', async () => {
    supabase.isAvailable.mockReturnValue(false);
    expect((await invitar(DUENO, {})).error).toBe('sin_base');
  });
});

describe('listar y revocar', () => {
  beforeEach(async () => {
    await invitar(DUENO, { email: 'del-dueno@gmail.com' });
    await invitar(SECRE, { email: 'de-la-secre@gmail.com' });
    await invitar(OTRO_DUENO, { email: 'de-otro-consultorio@gmail.com' });
  });

  test('el dueño ve todas las de SU consultorio (y nada del otro); la secretaria, solo las suyas', async () => {
    const dueno = await svc.listarInvitaciones(DUENO);
    expect(dueno.invitaciones.map(i => i.email).sort()).toEqual(['de-la-secre@gmail.com', 'del-dueno@gmail.com']);
    const secre = await svc.listarInvitaciones(SECRE);
    expect(secre.invitaciones.map(i => i.email)).toEqual(['de-la-secre@gmail.com']);
    expect((await svc.listarInvitaciones(MEDICO)).error).toBe('sin_permiso');
  });

  test('una vencida se muestra como vencida', async () => {
    base.filas[0].expira_en = new Date(Date.now() - 1000).toISOString();
    const { invitaciones } = await svc.listarInvitaciones(DUENO);
    expect(invitaciones.find(i => i.email === 'del-dueno@gmail.com').estado).toBe('vencida');
  });

  test('revocar: la secretaria solo las suyas; el dueño cualquiera de su consultorio; nadie las de otro consultorio', async () => {
    const delDueno = base.filas.find(f => f.email === 'del-dueno@gmail.com').id;
    const deLaSecre = base.filas.find(f => f.email === 'de-la-secre@gmail.com').id;
    const deOtro = base.filas.find(f => f.email === 'de-otro-consultorio@gmail.com').id;

    expect((await svc.revocarInvitacion(SECRE, delDueno)).error).toBe('no_encontrada');
    expect((await svc.revocarInvitacion(DUENO, deOtro)).error).toBe('no_encontrada'); // otro tenant
    expect((await svc.revocarInvitacion(SECRE, deLaSecre)).ok).toBe(true);
    expect((await svc.revocarInvitacion(DUENO, delDueno)).ok).toBe(true);
    expect((await svc.revocarInvitacion(DUENO, delDueno)).error).toBe('no_encontrada'); // ya revocada
    expect((await svc.revocarInvitacion(MEDICO, deLaSecre)).error).toBe('sin_permiso');
    expect(base.filas.find(f => f.id === deOtro).estado).toBe('pendiente');
  });
});

describe('canjearPorGoogle: crea la cuenta sin Telegram', () => {
  const g = { sub: 'sub-123', email: 'nuevo@gmail.com', nombre: 'Nuevo Odontólogo' };

  test('sin invitación no crea nada (un Gmail cualquiera no entra)', async () => {
    const r = await svc.canjearPorGoogle(g);
    expect(r).toEqual({ ok: false, motivo: 'sin_invitacion' });
    expect(clienteService.guardarClientes).not.toHaveBeenCalled();
    expect(Object.keys(clienteService.clientes)).toEqual(['1', '50']);
  });

  test('con invitación: cuenta nueva con ID negativo, permisos elegidos y el Sheet del dueño', async () => {
    await invitar(DUENO, { permisos: ['ver_agenda', 'editar_agenda'] });
    const r = await svc.canjearPorGoogle(g);
    expect(r.ok).toBe(true);
    expect(r.ownerId).toBe('1');
    const id = Number(r.userId);
    expect(id).toBeLessThan(0);
    expect(Number.isSafeInteger(id)).toBe(true);

    const c = clienteService.clientes;
    expect(c[r.userId]).toMatchObject({ email: 'nuevo@gmail.com', sheetId: 'S1', googleSub: 'sub-123' });
    expect(c['1'].usuarios).toContain(id);
    expect(c['1'].permisos[r.userId]).toEqual(['ver_agenda', 'editar_agenda']);
    expect(clienteService.guardarClientes).toHaveBeenCalledWith(c, ['1', r.userId]);

    // El resto del sistema lo reconoce como invitado del dueño, con esos permisos.
    expect(obtenerClientePorUserId(id)).toMatchObject({ ownerId: '1', isOwner: false, sheetId: 'S1' });
    expect(resolverPermisos(id)).toEqual(['ver_agenda', 'editar_agenda']);

    expect(base.filas[0]).toMatchObject({ estado: 'usada', usada_por: id });
  });

  test('se usa UNA sola vez', async () => {
    await invitar(DUENO, {});
    expect((await svc.canjearPorGoogle(g)).ok).toBe(true);
    expect((await svc.canjearPorGoogle({ ...g, sub: 'otro-sub' })).motivo).toBe('sin_invitacion');
    expect(clienteService.guardarClientes).toHaveBeenCalledTimes(1);
  });

  test('dos canjes a la vez: solo uno gana', async () => {
    await invitar(DUENO, {});
    const [a, b] = await Promise.all([svc.canjearPorGoogle(g), svc.canjearPorGoogle({ ...g, sub: 'otro-sub' })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(clienteService.guardarClientes).toHaveBeenCalledTimes(1);
    expect(clienteService.clientes['1'].usuarios).toHaveLength(3);
  });

  test('vencida o revocada: no sirve', async () => {
    await invitar(DUENO, {});
    base.filas[0].expira_en = new Date(Date.now() - 1000).toISOString();
    expect((await svc.canjearPorGoogle(g)).motivo).toBe('sin_invitacion');

    base.filas[0].expira_en = new Date(Date.now() + 100000).toISOString();
    await svc.revocarInvitacion(DUENO, base.filas[0].id);
    expect((await svc.canjearPorGoogle(g)).motivo).toBe('sin_invitacion');
  });

  test('una invitación a otro email no sirve para este', async () => {
    await invitar(DUENO, { email: 'otra-persona@gmail.com' });
    expect((await svc.canjearPorGoogle(g)).motivo).toBe('sin_invitacion');
  });

  test('la invitación de un consultorio da acceso a ESE consultorio y no al de otro', async () => {
    await svc.crearInvitacion(OTRO_DUENO, { email: g.email });
    const r = await svc.canjearPorGoogle(g);
    expect(r.ownerId).toBe('50');
    expect(clienteService.clientes['50'].usuarios).toContain(Number(r.userId));
    expect(clienteService.clientes['1'].usuarios).toEqual([SECRE, MEDICO]);
    expect(obtenerClientePorUserId(Number(r.userId)).sheetId).toBe('S2');
  });

  test('registra al profesional si la invitación lo pedía', async () => {
    await invitar(DUENO, { profesional: { nombre: 'Dra. Paula', consultorio: 'Consultorio 3' } });
    const r = await svc.canjearPorGoogle(g);
    expect(profesionales.registrarProfesional).toHaveBeenCalledWith('t1', Number(r.userId), 'Dra. Paula', 'Consultorio 3');
    expect(agenda.invalidarConsultorioMap).toHaveBeenCalledWith('t1');
  });

  test('si falla registrar al profesional, la cuenta igual queda creada', async () => {
    profesionales.registrarProfesional.mockResolvedValue({ ok: false, error: 'boom' });
    await invitar(DUENO, { profesional: { nombre: 'Dra. Paula' } });
    expect((await svc.canjearPorGoogle(g)).ok).toBe(true);
  });

  test('si no se puede guardar la cuenta, se deshace todo y la invitación sigue disponible', async () => {
    await invitar(DUENO, {});
    clienteService.guardarClientes.mockRejectedValueOnce(new Error('disco lleno'));
    const r = await svc.canjearPorGoogle(g);
    expect(r).toEqual({ ok: false, motivo: 'error_interno' });
    expect(Object.keys(clienteService.clientes)).toEqual(['1', '50']);
    expect(clienteService.clientes['1'].usuarios).toEqual([SECRE, MEDICO]);
    expect(clienteService.clientes['1'].permisos[SECRE]).toBeDefined();
    expect(base.filas[0].estado).toBe('pendiente');
    expect((await svc.canjearPorGoogle(g)).ok).toBe(true); // se puede reintentar
  });

  test('si el dueño ya no existe, no se crea nada', async () => {
    await invitar(DUENO, {});
    delete clienteService.clientes['1'];
    expect((await svc.canjearPorGoogle(g)).motivo).toBe('dueno_inexistente');
    expect(base.filas[0].estado).toBe('pendiente');
  });

  test('sin soporte de Google en la base, o sin Supabase, no canjea', async () => {
    await invitar(DUENO, {});
    clienteService.googleSoportado.mockReturnValue(false);
    expect((await svc.canjearPorGoogle(g)).ok).toBe(false);
    clienteService.googleSoportado.mockReturnValue(true);
    supabase.isAvailable.mockReturnValue(false);
    expect((await svc.canjearPorGoogle(g)).motivo).toBe('sin_invitacion');
  });
});

describe('IDs de cuentas web', () => {
  test('son negativos, enteros seguros y no repiten uno existente', () => {
    const existentes = {};
    const vistos = new Set();
    for (let i = 0; i < 200; i++) {
      const id = svc._generarIdWeb(existentes);
      expect(id).toBeLessThan(0);
      expect(Number.isSafeInteger(id)).toBe(true);
      expect(vistos.has(id)).toBe(false);
      vistos.add(id);
      existentes[String(id)] = {};
    }
  });
});
