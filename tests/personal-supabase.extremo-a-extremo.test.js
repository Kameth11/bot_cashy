// Camino COMPLETO del Personal por persona (PERSONAL_STORE=supabase), con las piezas
// reales: mensaje de Telegram -> parser -> detección de ámbito -> confirmación real ->
// botón Guardar -> servicio -> repositorio -> (Supabase falso) -> API del dashboard.
// Solo se simulan Telegram, Gemini y Supabase.
//
// Es el caso real: un agregado del consultorio (la mamá) manda "pasaje a Puerto Madryn
// 500 dólares" y tiene que quedar en SU Personal, visible solo para ella.

global.__bot = { text: null, actions: {} };

jest.mock('../src/lib/telegraf', () => ({
  bot: {
    on: (e, h) => { global.__bot[e] = h; },
    action: (re, h) => { global.__bot.actions[String(re)] = h; },
    command: jest.fn(), use: jest.fn(), hears: jest.fn(), catch: jest.fn(),
    telegram: { sendMessage: jest.fn().mockResolvedValue(true) },
  },
}));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/config', () => ({
  METODOS_VALIDOS: ['efectivo', 'transferencia', 'tarjeta'], COMANDOS_INGRESO: ['consulta', 'servicio'], COMANDOS_EGRESO: ['gasto'],
  MAX_TEXT_LENGTH: 1000, MAX_DESCRIPCION_LENGTH: 120, MAX_MOVIMIENTO_MONTO: 1000000000, MAX_COTIZACION_DOLAR: 100000,
  AUTHORIZED_USER_ID: 1111, ALLOWED_EMAILS: [], CODIGO_EXPIRACION_HORAS: 24, MAX_INTENTOS_CODIGO: 5, DASHBOARD_URL: null,
  JWT_SECRET: 'test-secret-personal-e2e', USE_SUPABASE: true, PERSONAL_STORE: 'supabase',
  CLIENTES_FILE: '/tmp/clientes_personal_e2e_test.json', SPREADSHEET_ID: 'sheet-test', DASHBOARD_API_PORT: 0,
  SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60, MAX_PHOTO_SIZE_BYTES: 1024 * 1024,
}));
jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': { email: 'owner@test.com', sheetId: 'sheet-owner', usuarios: [3333], permisos: { '3333': ['ver_agenda', 'ver_movimientos', 'cargar_movimientos'] } },
    };
  },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(), eliminarCliente: jest.fn(),
  getPermisos: jest.fn(), setPermisos: jest.fn(), getCasas: jest.fn(() => []), setCasas: jest.fn(),
}));
jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn(() => true) }));
jest.mock('../src/services/tenant.service', () => ({
  ...jest.requireActual('../src/services/tenant.service'),
  resolveTenantId: jest.fn().mockResolvedValue('t1'),
}));
jest.mock('../src/services/db.service', () => ({
  ...jest.requireActual('../src/services/db.service'),
  ensureProfile: jest.fn().mockResolvedValue(undefined),
}));
// Trampa: en modo supabase NADA de Personal puede tocar el Sheet.
jest.mock('../src/services/sheet-tab.service', () => ({
  getOrCreateTab: jest.fn(() => { throw new Error('NO debe tocar el Sheet en modo supabase'); }),
}));
jest.mock('../src/handlers/commands/salir', () => ({ procesarConfirmacionSalir: jest.fn() }));
jest.mock('../src/handlers/commands/sheet', () => ({ handleSheetCommand: jest.fn() }));
jest.mock('../src/handlers/actions', () => ({ confirmButtons: jest.fn().mockReturnValue({}) }));
jest.mock('../src/handlers/cobrar-confirm', () => ({ mostrarCobrar: jest.fn() }));
jest.mock('../src/services/gemini.service', () => ({ canAttemptRemoteNlp: jest.fn().mockReturnValue(false), parseMessage: jest.fn() }));
jest.mock('../src/services/openrouter.service', () => ({ canAttemptFullIA: jest.fn().mockReturnValue(false), parseMessage: jest.fn() }));
jest.mock('../src/services/registration.service', () => ({ handlePendingRegistration: jest.fn() }));

const crypto = require('crypto');
const config = require('../src/config');
const state = require('../src/state');
const { getSupabase } = require('../src/lib/supabase');
const sheetTab = require('../src/services/sheet-tab.service');
const repo = require('../src/services/personal-repo.supabase');
const personal = require('../src/services/personal.service');
require('../src/handlers/text');
require('../src/handlers/nlp-confirm');
const { app, JWT_SECRET } = require('../src/api/index.js');
const { crearSupabaseFalso } = require('./helpers/fake-supabase');

const DUENO = 2222;
const MAMA = 3333;   // agregada al consultorio del dueño

let server, baseUrl, fake;
beforeAll(async () => { await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); }); });
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => {
  jest.clearAllMocks();
  config.PERSONAL_STORE = 'supabase';
  fake = crearSupabaseFalso();
  getSupabase.mockReturnValue(fake);
  repo._reiniciarCache();
  state.pendingNlpMovimientos.clear();
  state.processingNlp.clear();
});
afterEach(() => expect(sheetTab.getOrCreateTab).not.toHaveBeenCalled());

function token(userId) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ userId: String(userId), type: 'dashboard', iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  return `${h}.${p}.${crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
const api = async (path, userId) => {
  const r = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token(userId)}` } });
  return { status: r.status, body: await r.json() };
};

// Lo que hace la persona en Telegram: escribe y toca "Guardar".
async function escribir(userId, texto) {
  const ctx = { from: { id: userId }, message: { text: texto }, reply: jest.fn().mockResolvedValue(true) };
  await global.__bot.text(ctx);
  return ctx;
}
async function tocarGuardar(userId) {
  const ctx = { from: { id: userId }, answerCbQuery: jest.fn().mockResolvedValue(true), editMessageText: jest.fn().mockResolvedValue(true) };
  await global.__bot.actions.nlp_save(ctx);
  return ctx;
}
const mes = () => personal.mesActualIso();

describe('la mamá (agregada) tiene SU Personal', () => {
  test('"pagué pasaje a puerto madryn 500 dólares" -> confirmación PERSONAL -> se guarda a su nombre', async () => {
    const ctx = await escribir(MAMA, 'pagué pasaje a puerto madryn 500 dólares');

    // 1) la confirmación dice Personal (antes, para un agregado, siempre decía Consultorio)
    const confirmacion = ctx.reply.mock.calls[0][0];
    expect(confirmacion).toContain('🏠 Personal');
    expect(confirmacion).toContain('viajes');
    expect(confirmacion).not.toContain('Consultorio');

    // 2) Guardar
    const cb = await tocarGuardar(MAMA);
    expect(cb.editMessageText.mock.calls[0][0]).toContain('Gasto personal registrado');

    // 3) quedó en la base a SU nombre (y no en el Sheet: la trampa lo verifica)
    expect(fake.tablas.movimientos_personales).toHaveLength(1);
    expect(fake.tablas.movimientos_personales[0]).toMatchObject({
      user_id: MAMA, created_by: MAMA, tenant_id: 't1', categoria: 'viajes', moneda: 'Dólares', monto_original: 500, tipo_movimiento: 'egreso',
    });
  });

  test('la mamá lo ve en su dashboard y el DUEÑO no', async () => {
    await escribir(MAMA, 'pagué pasaje a puerto madryn 500 dólares');
    await tocarGuardar(MAMA);

    const suyo = await api(`/api/personal/resumen?mes=${mes()}`, MAMA);
    expect(suyo.status).toBe(200);
    expect(suyo.body.movimientos).toHaveLength(1);
    expect(suyo.body.movimientos[0]).toMatchObject({ categoria: 'viajes', moneda: 'Dólares', monto: 500 });

    const delDueno = await api(`/api/personal/resumen?mes=${mes()}`, DUENO);
    expect(delDueno.status).toBe(200);
    expect(delDueno.body.movimientos).toHaveLength(0);
    expect(delDueno.body.egresos).toBe(0);
  });

  test('y a la inversa: lo personal del dueño no lo ve ella', async () => {
    await escribir(DUENO, 'pague 15000 pesos para el cine');
    await tocarGuardar(DUENO);
    await escribir(MAMA, 'pagué pasaje a puerto madryn 500 dólares');
    await tocarGuardar(MAMA);

    const dueno = await api(`/api/personal/resumen?mes=${mes()}`, DUENO);
    const mama = await api(`/api/personal/resumen?mes=${mes()}`, MAMA);
    expect(dueno.body.movimientos.map((m) => m.categoria)).toEqual(['entretenimiento']);
    expect(mama.body.movimientos.map((m) => m.categoria)).toEqual(['viajes']);

    const filas = fake.tablas.movimientos_personales;
    expect(filas.map((f) => f.user_id).sort()).toEqual([DUENO, MAMA]);
  });

  test('ella no puede mirar el Personal del dueño pasando su id', async () => {
    await escribir(DUENO, 'pague 15000 pesos para el cine');
    await tocarGuardar(DUENO);
    const intento = await api(`/api/personal/resumen?mes=${mes()}&userId=${DUENO}&de=${DUENO}`, MAMA);
    expect(intento.body.movimientos).toHaveLength(0);
    const lista = await api(`/api/personal/movimientos?userId=${DUENO}`, MAMA);
    expect(lista.body.movimientos).toHaveLength(0);
  });

  test('el dashboard sabe que ella ve la sección Personal', async () => {
    const me = await api('/api/auth/me', MAMA);
    expect(me.body.user.puedePersonal).toBe(true);
  });
});

describe('antes de activar (modo sheets) todo sigue como estaba', () => {
  test('la mamá sigue forzada a consultorio y no se escribe nada en Supabase', async () => {
    config.PERSONAL_STORE = 'sheets';
    const ctx = await escribir(MAMA, 'pagué pasaje a puerto madryn 500 dólares');
    const confirmacion = ctx.reply.mock.calls[0][0];
    expect(confirmacion).toContain('Consultorio');
    expect(confirmacion).not.toContain('🏠 Personal');
    expect(fake.tablas.movimientos_personales || []).toHaveLength(0);

    const r = await api(`/api/personal/resumen?mes=${mes()}`, MAMA);
    expect(r.status).toBe(403);
    expect((await api('/api/auth/me', MAMA)).body.user.puedePersonal).toBe(false);
  });
});

describe('si la base falla, el usuario se entera', () => {
  test('al guardar: error visible, no un falso "registrado"', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fake = crearSupabaseFalso({ errorEn: { tabla: 'movimientos_personales', op: 'insert', mensaje: 'caída simulada' } });
    getSupabase.mockReturnValue(fake);

    await escribir(MAMA, 'pagué pasaje a puerto madryn 500 dólares');
    const cb = await tocarGuardar(MAMA);
    const msg = cb.editMessageText.mock.calls[0][0];
    expect(msg).toMatch(/Error al guardar/);
    expect(msg).not.toContain('registrado');
  });
});
