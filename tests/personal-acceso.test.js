// ¿Quién puede usar Personal? Depende del modo de almacenamiento (PERSONAL_STORE).

jest.mock('../src/config', () => ({ AUTHORIZED_USER_ID: 1111, PERSONAL_STORE: 'sheets', USE_SUPABASE: true }));
jest.mock('../src/auth', () => ({
  esAdminOriginal: jest.fn((id) => Number(id) === 1111),
  obtenerClientePorUserId: jest.fn((id) => ({
    2222: { ownerId: 2222, isOwner: true },
    3333: { ownerId: 2222, isOwner: false }, // agregado del consultorio de 2222
  }[Number(id)] || null)),
}));

const config = require('../src/config');
const { puedeUsarPersonal } = require('../src/auth/personal-acceso');
const { personalEnSupabase } = require('../src/lib/personal-store');

describe("modo 'sheets' (el de siempre): solo dueño y admin", () => {
  beforeEach(() => { config.PERSONAL_STORE = 'sheets'; config.USE_SUPABASE = true; });

  test.each([[1111, true], [2222, true], [3333, false], [9999, false]])('usuario %s -> %s', (id, esperado) => {
    expect(puedeUsarPersonal(id)).toBe(esperado);
  });

  test('personalEnSupabase es false', () => expect(personalEnSupabase()).toBe(false));
});

describe("modo 'supabase': cualquier usuario REGISTRADO tiene el suyo", () => {
  beforeEach(() => { config.PERSONAL_STORE = 'supabase'; config.USE_SUPABASE = true; });

  test.each([[1111, true], [2222, true], [3333, true]])('usuario %s -> %s', (id, esperado) => {
    expect(puedeUsarPersonal(id)).toBe(esperado);
  });

  test('una persona NO registrada sigue sin acceso', () => {
    expect(puedeUsarPersonal(9999)).toBe(false);
  });

  test('llega el id como string (JWT / Telegram)', () => {
    expect(puedeUsarPersonal('3333')).toBe(true);
    expect(puedeUsarPersonal('9999')).toBe(false);
  });
});

describe("PERSONAL_STORE=supabase sin USE_SUPABASE: se ignora (sigue en el Sheet)", () => {
  test('no abre Personal a los agregados', () => {
    config.PERSONAL_STORE = 'supabase';
    config.USE_SUPABASE = false;
    expect(personalEnSupabase()).toBe(false);
    expect(puedeUsarPersonal(3333)).toBe(false);
  });
});
