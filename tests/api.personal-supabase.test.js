// /api/personal/*: en modo 'sheets' sigue siendo solo del dueño; en modo 'supabase' cada
// usuario registrado ve y toca SOLO el suyo. (El modo 'sheets' también lo cubre
// tests/api.personal-permisos.test.js.)

jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } } }));
jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  JWT_SECRET: 'test-secret-personal-supabase',
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  USE_SUPABASE: true,
  PERSONAL_STORE: 'sheets',
  CLIENTES_FILE: '/tmp/clientes_personal_supabase_test.json',
  SPREADSHEET_ID: 'sheet-test',
  DASHBOARD_API_PORT: 0,
  SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));
jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': { email: 'owner@test.com', sheetId: 'sheet-owner', usuarios: [3333, 4444], permisos: {
        '3333': ['ver_agenda', 'ver_movimientos', 'cargar_movimientos'], '4444': ['ver_agenda'],
      } },
    };
  },
  cargarClientes: jest.fn().mockResolvedValue({}), guardarClientes: jest.fn().mockResolvedValue(undefined),
  getCliente: jest.fn(), eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/personal.service', () => ({
  ...jest.requireActual('../src/services/personal.service'),
  calcularResumenPersonal: jest.fn(async () => ({ mes: '2026-10', ingresos: 0, egresos: 0, balance: 0, cantidad: 0, porCategoria: [], presupuestos: [], viaje: null, movimientos: [] })),
  obtenerMovimientosPersonales: jest.fn(async () => []),
  registrarMovimientoPersonal: jest.fn(async () => ({ movimiento: { idMov: 'pers_1' } })),
  eliminarMovimientoPersonal: jest.fn(async () => true),
  actualizarMovimientoPersonal: jest.fn(async () => ({ idMov: 'pers_1', descripcion: 'Editado' })),
  obtenerPresupuestos: jest.fn(async () => []),
  guardarPresupuesto: jest.fn(async () => ({})),
  obtenerViajeActivo: jest.fn(async () => null),
  crearViaje: jest.fn(async () => ({ idViaje: 'v1' })),
  cerrarViaje: jest.fn(async () => null),
}));

const crypto = require('crypto');
const config = require('../src/config');
const personal = require('../src/services/personal.service');
const { app, JWT_SECRET } = require('../src/api/index.js');

function token(userId) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ userId: String(userId), type: 'dashboard', iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  return `${h}.${p}.${crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`;
}

let server, baseUrl;
beforeAll(async () => { await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); }); });
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => { jest.clearAllMocks(); config.PERSONAL_STORE = 'sheets'; });

const req = (method, path, userId, body) => fetch(`${baseUrl}${path}`, {
  method, headers: { Authorization: `Bearer ${token(userId)}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});

describe("modo 'sheets': solo el dueño", () => {
  test('el agregado recibe 403 y el servicio no se llama', async () => {
    const r = await req('GET', '/api/personal/resumen?mes=2026-10', 3333);
    expect(r.status).toBe(403);
    expect(personal.calcularResumenPersonal).not.toHaveBeenCalled();
  });

  test('el dueño sí', async () => {
    expect((await req('GET', '/api/personal/resumen?mes=2026-10', 2222)).status).toBe(200);
  });
});

describe("modo 'supabase': cada usuario registrado, con lo suyo", () => {
  beforeEach(() => { config.PERSONAL_STORE = 'supabase'; });

  test('el agregado accede y el servicio recibe SU id (no el del dueño)', async () => {
    const r = await req('GET', '/api/personal/resumen?mes=2026-10', 3333);
    expect(r.status).toBe(200);
    expect(personal.calcularResumenPersonal).toHaveBeenCalledWith('3333', '2026-10');
  });

  test('un id pasado por el request se IGNORA: no se puede mirar el Personal de otra persona', async () => {
    await req('GET', '/api/personal/resumen?mes=2026-10&userId=2222&de=2222&user_id=2222', 3333);
    expect(personal.calcularResumenPersonal).toHaveBeenCalledWith('3333', '2026-10');
    await req('GET', '/api/personal/movimientos?userId=2222', 3333);
    expect(personal.obtenerMovimientosPersonales).toHaveBeenCalledWith('3333');
  });

  test('cargar y borrar, siempre con la identidad del token', async () => {
    const alta = await req('POST', '/api/personal/movimientos', 3333, {
      userId: '2222', descripcion: 'Pasaje a Puerto Madryn', monto: 500, tipo: 'Egreso', moneda: 'Dólares', categoria: 'viajes',
    });
    expect(alta.status).toBe(201);
    expect(personal.registrarMovimientoPersonal).toHaveBeenCalledWith('3333', expect.objectContaining({ monto: 500, moneda: 'Dólares', categoria: 'viajes', origenCarga: 'web' }));

    const baja = await req('DELETE', '/api/personal/movimientos/pers_1', 3333);
    expect(baja.status).toBe(200);
    expect(personal.eliminarMovimientoPersonal).toHaveBeenCalledWith('3333', 'pers_1');
  });

  test('presupuestos y viajes también son del usuario del token', async () => {
    await req('PUT', '/api/personal/presupuestos', 4444, { categoria: 'supermercado', montoMensual: 100000 });
    expect(personal.guardarPresupuesto).toHaveBeenCalledWith('4444', 'supermercado', 100000, expect.anything());
    await req('GET', '/api/personal/viajes', 4444);
    expect(personal.obtenerViajeActivo).toHaveBeenCalledWith('4444');
  });

  test('las categorías están disponibles', async () => {
    const r = await req('GET', '/api/personal/categorias', 3333);
    expect(r.status).toBe(200);
    expect((await r.json()).egreso).toContain('viajes');
  });
});

describe('/api/auth/me: puedePersonal le dice al dashboard si mostrar la sección', () => {
  const me = async (id) => (await (await req('GET', '/api/auth/me', id)).json()).user.puedePersonal;

  test("modo 'sheets': dueño y admin sí, agregados no", async () => {
    expect(await me(2222)).toBe(true);
    expect(await me(1111)).toBe(true);
    expect(await me(3333)).toBe(false);
  });

  test("modo 'supabase': también los agregados", async () => {
    config.PERSONAL_STORE = 'supabase';
    expect(await me(2222)).toBe(true);
    expect(await me(3333)).toBe(true);
    expect(await me(4444)).toBe(true);
  });
});


describe('PUT /api/personal/movimientos/:id (editar)', () => {
  beforeEach(() => { config.PERSONAL_STORE = 'supabase'; });

  test('edita con la identidad del token, aunque el request traiga otro userId', async () => {
    const r = await req('PUT', '/api/personal/movimientos/pers_1?userId=2222', 3333, { descripcion: 'Super Coto', monto: 1500, userId: 2222, user_id: 2222 });
    expect(r.status).toBe(200);
    expect(personal.actualizarMovimientoPersonal).toHaveBeenCalledWith('3333', 'pers_1', { descripcion: 'Super Coto', monto: 1500 });
  });

  test('solo pasa los campos editables que vinieron (nada de tipo, id, user_id)', async () => {
    await req('PUT', '/api/personal/movimientos/pers_1', 3333, { categoria: 'supermercado', moneda: 'Dolares', metodoPago: 'tarjeta', tipo: 'Ingreso', idMov: 'x', fecha: '03/10/2026' });
    expect(personal.actualizarMovimientoPersonal).toHaveBeenCalledWith('3333', 'pers_1', { categoria: 'supermercado', moneda: 'Dólares', metodoPago: 'tarjeta', fecha: '03/10/2026' });
  });

  test.each([
    ['monto cero', { monto: 0 }],
    ['monto no numérico', { monto: 'abc' }],
    ['descripción vacía', { descripcion: '  ' }],
    ['moneda inválida', { moneda: 'Bitcoin' }],
    ['fecha inválida', { fecha: '2026-10-03' }],
    ['fecha imposible', { fecha: '31/02/2026' }],
  ])('400 con %s y no toca el servicio', async (_n, body) => {
    const r = await req('PUT', '/api/personal/movimientos/pers_1', 3333, body);
    expect(r.status).toBe(400);
    expect(personal.actualizarMovimientoPersonal).not.toHaveBeenCalled();
  });

  test('404 si no existe o es de otra persona (el servicio devuelve null)', async () => {
    personal.actualizarMovimientoPersonal.mockResolvedValueOnce(null);
    expect((await req('PUT', '/api/personal/movimientos/pers_ajeno', 3333, { monto: 10 })).status).toBe(404);
  });

  test('los errores de validación del servicio salen como 400 con mensaje', async () => {
    personal.actualizarMovimientoPersonal.mockRejectedValueOnce(new Error('categoria_invalida'));
    const r = await req('PUT', '/api/personal/movimientos/pers_1', 3333, { categoria: 'sueldo' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/categoría/);
  });

  test("en modo 'sheets' un agregado sigue sin acceso", async () => {
    config.PERSONAL_STORE = 'sheets';
    expect((await req('PUT', '/api/personal/movimientos/pers_1', 3333, { monto: 10 })).status).toBe(403);
    expect(personal.actualizarMovimientoPersonal).not.toHaveBeenCalled();
  });
});
