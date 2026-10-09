// /api/casa/*: acceso por membresía (no ownerOnly), validaciones y que no se
// filtren ids ajenos. casa.service se simula; el control de membresía real
// está cubierto en tests/casa.service.test.js.

jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } } }));
jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  JWT_SECRET: 'test-secret-api-casa',
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  USE_SUPABASE: false,
  CLIENTES_FILE: '/tmp/clientes_api_casa_test.json',
  SPREADSHEET_ID: 'sheet-test',
  DASHBOARD_API_PORT: 0,
  SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));
jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': { email: 'ana@test.com', sheetId: 'sheet-ana', usuarios: [], permisos: {} },
      '4444': { email: 'beto@test.com', sheetId: 'sheet-beto', usuarios: [], permisos: {} },
    };
  },
  cargarClientes: jest.fn().mockResolvedValue({}),
  guardarClientes: jest.fn().mockResolvedValue(undefined),
  getCliente: jest.fn(), eliminarCliente: jest.fn(), getPermisos: jest.fn(),
  setPermisos: jest.fn().mockResolvedValue(undefined),
  getCasas: jest.fn(() => []), setCasas: jest.fn().mockResolvedValue(true),
}));
jest.mock('../src/services/casa.service', () => {
  const actual = jest.requireActual('../src/services/casa.service');
  return {
    ...actual,
    listarMisCasas: jest.fn(),
    getCasaActiva: jest.fn(),
    setCasaActiva: jest.fn(),
    crearCasa: jest.fn(),
    unirMiembro: jest.fn(),
    obtenerCasaParaMiembro: jest.fn(),
    listarMiembros: jest.fn(),
    agregarMiembroVirtual: jest.fn(),
    quitarMiembro: jest.fn(),
    registrarGasto: jest.fn(),
    registrarLiquidacion: jest.fn(),
    listarMovimientos: jest.fn(),
    eliminarMovimiento: jest.fn(),
    editarMovimiento: jest.fn(),
    calcularSaldosCasa: jest.fn(),
    calcularResumenCasa: jest.fn(),
  };
});

const crypto = require('crypto');
const state = require('../src/state');
const casaService = require('../src/services/casa.service');
const { app, JWT_SECRET } = require('../src/api/index.js');

const { CasaError } = casaService;

function makeToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ userId: String(userId), type: 'dashboard', iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

let server, baseUrl;
beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});
afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

async function call(method, path, userId, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (userId) headers.Authorization = `Bearer ${makeToken(userId)}`;
  const conCuerpo = !['GET', 'HEAD'].includes(method) && body;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: conCuerpo ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch (_) { /* sin cuerpo */ }
  return { status: res.status, body: json };
}

const CTX = {
  casa: { casaId: 'casa_1', nombre: 'Casa' },
  ownerId: '2222',
  miembros: [
    { id: 'm1', userId: '2222', nombre: 'Ana', rol: 'creador', estado: 'activo' },
    { id: 'm2', userId: '4444', nombre: 'Beto', rol: 'miembro', estado: 'activo' },
    { id: 'm3', userId: '', nombre: 'Tomás', rol: 'miembro', estado: 'activo' },
  ],
  yo: { id: 'm1', userId: '2222', nombre: 'Ana' },
  esCreador: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  state.pendingInvitacionesCasa.clear();
  casaService.obtenerCasaParaMiembro.mockResolvedValue(CTX);
});

describe('autenticación', () => {
  test.each([
    ['GET', '/api/casa'],
    ['POST', '/api/casa'],
    ['GET', '/api/casa/categorias'],
    ['GET', '/api/casa/casa_1/resumen'],
    ['POST', '/api/casa/casa_1/movimientos'],
    ['DELETE', '/api/casa/casa_1/movimientos/x'],
    ['POST', '/api/casa/casa_1/invitaciones'],
    ['POST', '/api/casa/unir'],
  ])('%s %s sin token → 401', async (m, p) => {
    expect((await call(m, p, null, {})).status).toBe(401);
  });
});

describe('casas', () => {
  test('GET /api/casa devuelve solo lo mínimo (sin ownerId) y marca la activa', async () => {
    casaService.listarMisCasas.mockReturnValue([
      { casaId: 'c1', ownerId: '2222', nombre: 'Casa', activa: true },
      { casaId: 'c2', ownerId: '9999', nombre: 'Casa Dinamarca' },
    ]);
    casaService.getCasaActiva.mockReturnValue({ casaId: 'c1' });
    const r = await call('GET', '/api/casa', 2222);
    expect(r.status).toBe(200);
    expect(r.body.casas).toEqual([
      { casaId: 'c1', nombre: 'Casa', activa: true },
      { casaId: 'c2', nombre: 'Casa Dinamarca', activa: false },
    ]);
    expect(JSON.stringify(r.body)).not.toMatch(/ownerId|9999/);
  });

  test('POST /api/casa crea la casa; alias por defecto = parte local del email', async () => {
    casaService.crearCasa.mockResolvedValue({ casaId: 'c1', nombre: 'Casa Dinamarca', ownerId: '2222' });
    const r = await call('POST', '/api/casa', 2222, { nombre: 'Casa Dinamarca' });
    expect(r.status).toBe(201);
    expect(casaService.crearCasa).toHaveBeenCalledWith('2222', 'Casa Dinamarca', { alias: 'ana' });
    expect(r.body.casa).toEqual({ casaId: 'c1', nombre: 'Casa Dinamarca', activa: true });
    expect(JSON.stringify(r.body)).not.toMatch(/ownerId/);
  });

  test('errores del servicio → status y mensaje plano (sin emojis ni Markdown)', async () => {
    casaService.crearCasa.mockRejectedValue(new CasaError('solo_duenos'));
    const r1 = await call('POST', '/api/casa', 2222, { nombre: 'Casa' });
    expect(r1.status).toBe(403);
    expect(r1.body.error).not.toMatch(/[⚠️🔒`*]/u);
    expect(r1.body.code).toBe('solo_duenos');

    casaService.crearCasa.mockRejectedValue(new CasaError('nombre_repetido'));
    expect((await call('POST', '/api/casa', 2222, { nombre: 'Casa' })).status).toBe(409);
  });

  test('un error inesperado no se filtra (500 genérico)', async () => {
    casaService.crearCasa.mockRejectedValue(new Error('detalle interno secreto'));
    const r = await call('POST', '/api/casa', 2222, { nombre: 'Casa' });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/secreto/);
  });

  test('POST /api/casa/:id/activar', async () => {
    casaService.setCasaActiva.mockResolvedValue();
    expect((await call('POST', '/api/casa/casa_1/activar', 2222)).status).toBe(200);
    casaService.setCasaActiva.mockRejectedValue(new CasaError('no_miembro'));
    expect((await call('POST', '/api/casa/casa_9/activar', 2222)).status).toBe(403);
  });

  test('un id de casa con caracteres raros se rechaza antes de llegar al servicio', async () => {
    const r = await call('GET', '/api/casa/bad%20id/resumen', 2222);
    expect(r.status).toBe(400);
    expect(casaService.calcularResumenCasa).not.toHaveBeenCalled();
  });

  test('categorías: lista de gastos', async () => {
    const r = await call('GET', '/api/casa/categorias', 2222);
    expect(r.status).toBe(200);
    expect(r.body.egreso).toEqual(expect.arrayContaining(['supermercado']));
  });
});

describe('resumen', () => {
  test('no filtra ids de Telegram ni idOrigen; marca qué movimientos puede borrar', async () => {
    casaService.calcularResumenCasa.mockResolvedValue({
      casa: { casaId: 'casa_1', nombre: 'Casa', ownerId: '2222', creadaPor: '2222' },
      mes: '2026-10', esCreador: false,
      yo: { id: 'm2', userId: '4444', nombre: 'Beto' },
      miembros: CTX.miembros,
      gastosPorMoneda: { Pesos: 1400 },
      porCategoria: { servicios: 400, supermercado: 1000 },
      cantidad: 2,
      movimientos: [
        { idMov: 'a', tipo: 'gasto', descripcion: 'súper', monto: 1000, moneda: 'Pesos', pagoPor: 'm1', repartoEntre: ['m1', 'm2'], idOrigen: '2222', fecha: '05/10/2026' },
        { idMov: 'b', tipo: 'gasto', descripcion: 'luz', monto: 400, moneda: 'Pesos', pagoPor: 'm2', repartoEntre: ['m1', 'm2'], idOrigen: '4444', fecha: '06/10/2026' },
      ],
      saldos: { Pesos: { totalGastado: 1400, saldos: [], transferencias: [] } },
    });
    const r = await call('GET', '/api/casa/casa_1/resumen?mes=2026-10', 4444);
    expect(r.status).toBe(200);
    expect(casaService.calcularResumenCasa).toHaveBeenCalledWith('4444', 'casa_1', '2026-10');

    const txt = JSON.stringify(r.body);
    expect(txt).not.toMatch(/2222|ownerId|idOrigen|userId|creadaPor/);
    expect(r.body.porCategoria).toEqual([{ categoria: 'supermercado', total: 1000 }, { categoria: 'servicios', total: 400 }]);
    expect(r.body.movimientos.map((m) => m.puedoBorrar)).toEqual([false, true]); // no es creador: solo el suyo
    expect(r.body.miembros).toEqual([
      { id: 'm1', nombre: 'Ana', esVirtual: false, rol: 'creador' },
      { id: 'm2', nombre: 'Beto', esVirtual: false, rol: 'miembro' },
      { id: 'm3', nombre: 'Tomás', esVirtual: true, rol: 'miembro' },
    ]);
  });

  test('mes inválido se ignora; un no miembro recibe 403', async () => {
    casaService.calcularResumenCasa.mockRejectedValue(new CasaError('no_miembro'));
    const r = await call('GET', '/api/casa/casa_1/resumen?mes=hola', 4444);
    expect(r.status).toBe(403);
    expect(casaService.calcularResumenCasa).toHaveBeenCalledWith('4444', 'casa_1', undefined);
  });

  test('casa inexistente → 404', async () => {
    casaService.calcularResumenCasa.mockRejectedValue(new CasaError('casa_inexistente'));
    expect((await call('GET', '/api/casa/casa_1/resumen', 2222)).status).toBe(404);
  });
});

describe('POST movimientos', () => {
  const ok = { descripcion: 'Súper del sábado', monto: 45000, categoria: 'supermercado', moneda: 'Pesos', metodoPago: 'efectivo' };
  beforeEach(() => casaService.registrarGasto.mockResolvedValue({ movimiento: { idMov: 'cmov_1' }, miembros: CTX.miembros }));

  test('crea el gasto y pasa pagó/reparto/fecha normalizada al servicio', async () => {
    const r = await call('POST', '/api/casa/casa_1/movimientos', 2222, { ...ok, pagoPor: 'm2', repartoEntre: ['m1', 'm2'], fecha: '2026-10-05', moneda: 'Dolares' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ movimiento: { idMov: 'cmov_1' } });
    expect(casaService.registrarGasto).toHaveBeenCalledWith('2222', 'casa_1', expect.objectContaining({
      descripcion: 'Súper del sábado', monto: 45000, moneda: 'Dólares', metodoPago: 'efectivo', categoria: 'supermercado',
      pagoPor: 'm2', repartoEntre: ['m1', 'm2'], fecha: '05/10/2026',
    }));
  });

  test('categoría ausente → "otros"; método inválido → vacío', async () => {
    await call('POST', '/api/casa/casa_1/movimientos', 2222, { descripcion: 'algo útil', monto: 10, metodoPago: 'cheque' });
    expect(casaService.registrarGasto.mock.calls[0][2]).toMatchObject({ categoria: 'otros', metodoPago: '' });
  });

  test.each([
    [{ ...ok, descripcion: 'x' }, 'descripción'],
    [{ ...ok, monto: 0 }, 'monto'],
    [{ ...ok, monto: 'abc' }, 'monto'],
    [{ ...ok, categoria: 'no-existe' }, 'categoría'],
    [{ ...ok, fecha: 'ayer' }, 'fecha'],
  ])('rechaza datos inválidos (%#)', async (body) => {
    const r = await call('POST', '/api/casa/casa_1/movimientos', 2222, body);
    expect(r.status).toBe(400);
    expect(casaService.registrarGasto).not.toHaveBeenCalled();
  });

  test('un pagador de otra casa lo rechaza el servicio (400)', async () => {
    casaService.registrarGasto.mockRejectedValue(new CasaError('pagador_invalido'));
    const r = await call('POST', '/api/casa/casa_1/movimientos', 2222, { ...ok, pagoPor: 'mb_ajeno' });
    expect(r.status).toBe(400);
  });

  test('un no miembro → 403', async () => {
    casaService.registrarGasto.mockRejectedValue(new CasaError('no_miembro'));
    expect((await call('POST', '/api/casa/casa_1/movimientos', 4444, ok)).status).toBe(403);
  });
});

describe('DELETE movimiento y liquidaciones', () => {
  test('borrar: ok, no encontrado y sin permiso', async () => {
    casaService.eliminarMovimiento.mockResolvedValue(true);
    expect((await call('DELETE', '/api/casa/casa_1/movimientos/cmov_1', 2222)).status).toBe(200);
    casaService.eliminarMovimiento.mockResolvedValue(false);
    expect((await call('DELETE', '/api/casa/casa_1/movimientos/cmov_9', 2222)).status).toBe(404);
    casaService.eliminarMovimiento.mockRejectedValue(new CasaError('sin_permiso'));
    expect((await call('DELETE', '/api/casa/casa_1/movimientos/cmov_1', 4444)).status).toBe(403);
  });

  test('liquidación: registra con de/para/monto/moneda', async () => {
    casaService.registrarLiquidacion.mockResolvedValue({ movimiento: { idMov: 'cmov_2' } });
    const r = await call('POST', '/api/casa/casa_1/liquidaciones', 4444, { para: 'm1', monto: 500, moneda: 'Euros' });
    expect(r.status).toBe(201);
    expect(casaService.registrarLiquidacion).toHaveBeenCalledWith('4444', 'casa_1', { de: undefined, para: 'm1', monto: 500, moneda: 'Euros' });
  });

  test('liquidación con monto inválido → 400; consigo mismo → 400', async () => {
    expect((await call('POST', '/api/casa/casa_1/liquidaciones', 4444, { para: 'm1', monto: 0 })).status).toBe(400);
    casaService.registrarLiquidacion.mockRejectedValue(new CasaError('liquidacion_invalida'));
    expect((await call('POST', '/api/casa/casa_1/liquidaciones', 4444, { para: 'm2', monto: 5 })).status).toBe(400);
  });
});

describe('miembros e invitaciones', () => {
  test('listar y agregar un miembro sin Telegram', async () => {
    const l = await call('GET', '/api/casa/casa_1/miembros', 2222);
    expect(l.body.miembros).toHaveLength(3);
    expect(l.body.yo).toEqual({ id: 'm1', nombre: 'Ana' });
    expect(JSON.stringify(l.body)).not.toMatch(/4444|2222/);

    casaService.agregarMiembroVirtual.mockResolvedValue({ id: 'm9', nombre: 'Hijo' });
    const a = await call('POST', '/api/casa/casa_1/miembros', 2222, { nombre: 'Hijo' });
    expect(a.status).toBe(201);
    expect(a.body.miembro).toEqual({ id: 'm9', nombre: 'Hijo', esVirtual: true });
  });

  test('quitar: errores de permisos y saldo', async () => {
    casaService.quitarMiembro.mockRejectedValue(new CasaError('solo_creador'));
    expect((await call('DELETE', '/api/casa/casa_1/miembros/m1', 4444)).status).toBe(403);
    casaService.quitarMiembro.mockRejectedValue(new CasaError('saldo_pendiente'));
    expect((await call('DELETE', '/api/casa/casa_1/miembros/m2', 2222)).status).toBe(409);
  });

  test('invitación: el ownerId sale del servidor, NUNCA del body', async () => {
    const r = await call('POST', '/api/casa/casa_1/invitaciones', 2222, { ownerId: '9999', casaId: 'otra' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ codigo: expect.any(String), vigenciaHoras: 24 });
    expect(state.pendingInvitacionesCasa.get(r.body.codigo)).toMatchObject({ ownerId: '2222', casaId: 'casa_1', miembroId: null, creadoPor: '2222' });
  });

  test('invitación para un miembro sin Telegram; uno con Telegram o inexistente se rechaza', async () => {
    const ok = await call('POST', '/api/casa/casa_1/invitaciones', 2222, { miembroId: 'm3' });
    expect(state.pendingInvitacionesCasa.get(ok.body.codigo).miembroId).toBe('m3');
    expect((await call('POST', '/api/casa/casa_1/invitaciones', 2222, { miembroId: 'm2' })).status).toBe(404);
    expect((await call('POST', '/api/casa/casa_1/invitaciones', 2222, { miembroId: 'nadie' })).status).toBe(404);
  });

  test('un no miembro no puede emitir invitaciones', async () => {
    casaService.obtenerCasaParaMiembro.mockRejectedValue(new CasaError('no_miembro'));
    const r = await call('POST', '/api/casa/casa_1/invitaciones', 4444, {});
    expect(r.status).toBe(403);
    expect(state.pendingInvitacionesCasa._map.size).toBe(0);
  });

  test('unir: canjea un código válido y lo consume', async () => {
    state.pendingInvitacionesCasa.set('ABC234', { ownerId: '2222', casaId: 'casa_1', casaNombre: 'Casa', miembroId: null, creadoPor: '2222' });
    casaService.unirMiembro.mockResolvedValue({ casa: { casaId: 'casa_1', nombre: 'Casa' }, miembro: { id: 'm2' } });
    const r = await call('POST', '/api/casa/unir', 4444, { codigo: 'abc234', alias: 'Beto' });
    expect(r.status).toBe(201);
    expect(casaService.unirMiembro).toHaveBeenCalledWith('4444', { ownerId: '2222', casaId: 'casa_1', miembroId: null, alias: 'Beto' });
    expect(state.pendingInvitacionesCasa.has('ABC234')).toBe(false);
    expect(r.body.casa).toEqual({ casaId: 'casa_1', nombre: 'Casa' });
  });

  test('unir: código inválido → 400 y no se llama al servicio', async () => {
    const r = await call('POST', '/api/casa/unir', 4444, { codigo: 'NOEXISTE', alias: 'Beto' });
    expect(r.status).toBe(400);
    expect(casaService.unirMiembro).not.toHaveBeenCalled();
  });

  test('unir: si el servicio falla el código NO se consume', async () => {
    state.pendingInvitacionesCasa.set('ABC234', { ownerId: '2222', casaId: 'casa_1', casaNombre: 'Casa', miembroId: null, creadoPor: '2222' });
    casaService.unirMiembro.mockRejectedValue(new CasaError('nombre_repetido'));
    const r = await call('POST', '/api/casa/unir', 4444, { codigo: 'ABC234', alias: 'Ana' });
    expect(r.status).toBe(409);
    expect(state.pendingInvitacionesCasa.has('ABC234')).toBe(true);
  });
});


describe('PUT movimiento (editar)', () => {
  test('pasa solo los campos editables y la identidad del token', async () => {
    casaService.editarMovimiento.mockResolvedValue({ idMov: 'cmov_1' });
    const r = await call('PUT', '/api/casa/casa_1/movimientos/cmov_1?userId=9999', 2222, { descripcion: 'Super Coto', monto: 500, categoria: 'supermercado', pagoPor: 'm1', repartoEntre: ['m1', 'm2'], idMov: 'x', idOrigen: '9999', tipo: 'liquidacion' });
    expect(r.status).toBe(200);
    expect(casaService.editarMovimiento).toHaveBeenCalledWith('2222', 'casa_1', 'cmov_1', {
      descripcion: 'Super Coto', monto: 500, categoria: 'supermercado', pagoPor: 'm1', repartoEntre: ['m1', 'm2'],
    });
  });

  test.each([
    ['monto cero', { monto: 0 }],
    ['descripción vacía', { descripcion: ' ' }],
    ['categoría inventada', { categoria: 'inventada' }],
    ['fecha ilegible', { fecha: 'ayer' }],
    ['reparto que no es lista', { repartoEntre: 'm1' }],
    ['sin nada para cambiar', {}],
  ])('400 con %s y no toca el servicio', async (_n, body) => {
    casaService.editarMovimiento.mockClear();
    expect((await call('PUT', '/api/casa/casa_1/movimientos/cmov_1', 2222, body)).status).toBe(400);
    expect(casaService.editarMovimiento).not.toHaveBeenCalled();
  });

  test('404 si no existe, 403 sin permiso o no miembro, 400 si el servicio lo rechaza', async () => {
    casaService.editarMovimiento.mockResolvedValue(null);
    expect((await call('PUT', '/api/casa/casa_1/movimientos/cmov_9', 2222, { monto: 5 })).status).toBe(404);
    casaService.editarMovimiento.mockRejectedValue(new CasaError('sin_permiso'));
    expect((await call('PUT', '/api/casa/casa_1/movimientos/cmov_1', 4444, { monto: 5 })).status).toBe(403);
    casaService.editarMovimiento.mockRejectedValue(new CasaError('no_miembro'));
    expect((await call('PUT', '/api/casa/casa_1/movimientos/cmov_1', 4444, { monto: 5 })).status).toBe(403);
    casaService.editarMovimiento.mockRejectedValue(new CasaError('no_editable'));
    expect((await call('PUT', '/api/casa/casa_1/movimientos/cmov_1', 2222, { monto: 5 })).status).toBe(400);
  });
});
