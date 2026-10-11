// Vínculo de Telegram en profiles.telegram_id (migración 022): una cuenta nacida en la web (ID
// negativo) vincula DESPUÉS un Telegram. Solo si la columna existe.

jest.mock('fs', () => ({ existsSync: jest.fn(() => false), readFileSync: jest.fn(), writeFileSync: jest.fn() }));
jest.mock('../src/config', () => ({ CLIENTES_FILE: '/tmp/clientes_telegram_test.json', USE_SUPABASE: true }));
jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn(() => true) }));
jest.mock('../src/services/tenant-provisioning.service', () => ({ resolveOrCreateTenantId: jest.fn().mockResolvedValue('t1') }));

const { getSupabase } = require('../src/lib/supabase');
const clienteService = require('../src/services/cliente.service');

function crearSupabase(filas) {
  const ops = [];
  return {
    ops,
    from(tabla) {
      return {
        select: () => Promise.resolve({ data: filas, error: null }),
        upsert: (row) => { ops.push({ op: 'upsert', tabla, row }); return Promise.resolve({ error: null }); },
        update: (patch) => ({ eq: (c, v) => { ops.push({ op: 'update', tabla, patch, c, v }); return Promise.resolve({ error: null }); } }),
      };
    },
  };
}
const perfil = (id, extra = {}) => ({ id, sheet_id: `sheet-${id}`, email: `${id}@t.com`, usuarios: [], permisos: {}, ...extra });

const WEB = -1790000000000123;   // cuenta nacida en la web
const WEB2 = -1790000000000456;
const DUENO = 1;
const TG = 555000111;            // un Telegram sin cuenta
const TG_INVITADO = 777;         // un Telegram que ya es invitado de otro dueño

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

async function cargar(filas) {
  const sb = crearSupabase(filas);
  getSupabase.mockReturnValue(sb);
  await clienteService.cargarClientes();
  return sb;
}

test('sin la columna telegram_id (migración sin correr) vincular queda deshabilitado y no se escribe nada', async () => {
  const sb = await cargar([perfil(DUENO), perfil(WEB)]);
  expect(clienteService.telegramVinculoSoportado()).toBe(false);
  expect(await clienteService.vincularTelegram(WEB, TG)).toEqual({ ok: false, motivo: 'no_disponible' });
  expect(sb.ops).toEqual([]);
  expect(clienteService.buildProfileRow(String(WEB), { sheetId: 's' })).not.toHaveProperty('telegram_id');
});

test('con la columna: carga el Telegram vinculado, lo busca y lo escribe al vincular', async () => {
  const sb = await cargar([perfil(DUENO, { telegram_id: null }), perfil(WEB, { telegram_id: null }), perfil(WEB2, { telegram_id: 4242 })]);
  expect(clienteService.telegramVinculoSoportado()).toBe(true);
  expect(clienteService.cuentaPorTelegramId(4242)).toBe(String(WEB2));
  expect(clienteService.cuentaPorTelegramId('4242')).toBe(String(WEB2));
  expect(clienteService.cuentaPorTelegramId(999)).toBeNull();
  expect(clienteService.cuentaPorTelegramId('basura')).toBeNull();

  expect(await clienteService.vincularTelegram(WEB, TG)).toEqual({ ok: true });
  expect(clienteService.cuentaPorTelegramId(TG)).toBe(String(WEB));
  const up = sb.ops.find(o => o.op === 'upsert' && o.row.id === WEB);
  expect(up.row).toMatchObject({ id: WEB, telegram_id: TG });
});

test('solo vale para cuentas web (ID negativo): una cuenta de Telegram ya ES su Telegram', async () => {
  await cargar([perfil(DUENO, { telegram_id: null })]);
  expect(await clienteService.vincularTelegram(DUENO, TG)).toEqual({ ok: false, motivo: 'no_aplica' });
});

test('rechaza un Telegram que ya tiene cuenta propia (dueño o invitado de otro) o ya está vinculado a otra cuenta', async () => {
  await cargar([
    perfil(DUENO, { telegram_id: null, usuarios: [TG_INVITADO] }),
    perfil(WEB, { telegram_id: null }),
    perfil(WEB2, { telegram_id: 4242 }),
  ]);
  expect(await clienteService.vincularTelegram(WEB, DUENO)).toEqual({ ok: false, motivo: 'telegram_con_cuenta' });
  expect(await clienteService.vincularTelegram(WEB, TG_INVITADO)).toEqual({ ok: false, motivo: 'telegram_con_cuenta' });
  expect(await clienteService.vincularTelegram(WEB, 4242)).toEqual({ ok: false, motivo: 'telegram_en_uso' });
  expect(clienteService.cuentaPorTelegramId(TG_INVITADO)).toBeNull();
});

test('una cuenta no puede tener dos Telegram; repetir el mismo es idempotente', async () => {
  await cargar([perfil(DUENO, { telegram_id: null }), perfil(WEB, { telegram_id: 4242 })]);
  expect(await clienteService.vincularTelegram(WEB, TG)).toEqual({ ok: false, motivo: 'ya_vinculada_otra' });
  expect(await clienteService.vincularTelegram(WEB, 4242)).toEqual({ ok: true });
});

test('una cuenta que no existe no se puede vincular', async () => {
  await cargar([perfil(DUENO, { telegram_id: null })]);
  expect(await clienteService.vincularTelegram(-5, TG)).toEqual({ ok: false, motivo: 'sin_perfil' });
});

test('desvincular quita el Telegram en memoria y en la base', async () => {
  const sb = await cargar([perfil(DUENO, { telegram_id: null }), perfil(WEB, { telegram_id: 4242 })]);
  expect(await clienteService.desvincularTelegram(WEB)).toBe(true);
  expect(clienteService.cuentaPorTelegramId(4242)).toBeNull();
  expect(sb.ops).toContainEqual(expect.objectContaining({ op: 'update', patch: { telegram_id: null }, c: 'id', v: WEB }));
  expect(await clienteService.desvincularTelegram(WEB)).toBe(false); // ya no tenía
});
