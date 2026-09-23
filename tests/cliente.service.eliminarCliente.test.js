// Ítem 2.1: bajo el modelo nuevo, un invitado no tiene registro propio en
// `clientes` — solo figura en usuarios[] del dueño. eliminarCliente() antes
// únicamente borraba `clientes[userId]`, así que /salir no tenía ningún
// efecto real para un invitado (seguía en usuarios[] del dueño, con acceso
// intacto). Ahora también lo saca de usuarios[] de cualquier dueño donde
// figure.

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('../src/config', () => ({
  CLIENTES_FILE: '/tmp/clientes_eliminar_test.json',
  USE_SUPABASE: false,
}));

jest.mock('../src/lib/supabase', () => ({
  getSupabase: jest.fn(),
  isAvailable: jest.fn(() => false),
}));

const clienteService = require('../src/services/cliente.service');

const OWNER = '1000';
const INVITADO = 2000;

beforeEach(() => {
  clienteService.clientes = {
    [OWNER]: { sheetId: 'sheet-owner', usuarios: [INVITADO, 3000] },
  };
});

describe('eliminarCliente — invitado sin registro propio (modelo nuevo)', () => {
  test('lo saca de usuarios[] del dueño y devuelve true', async () => {
    const resultado = await clienteService.eliminarCliente(INVITADO);

    expect(resultado).toBe(true);
    expect(clienteService.clientes[OWNER].usuarios).not.toContain(INVITADO);
    expect(clienteService.clientes[OWNER].usuarios).toContain(3000);
  });

  test('usuario que no figura en ningún lado → false, no rompe nada', async () => {
    const resultado = await clienteService.eliminarCliente(9999);

    expect(resultado).toBe(false);
    expect(clienteService.clientes[OWNER].usuarios).toEqual([INVITADO, 3000]);
  });
});

describe('eliminarCliente — dueño real (con registro propio)', () => {
  test('borra su propio registro (comportamiento sin cambios)', async () => {
    const resultado = await clienteService.eliminarCliente(OWNER);

    expect(resultado).toBe(true);
    expect(clienteService.clientes[OWNER]).toBeUndefined();
  });
});

describe('eliminarCliente — invitado legacy (con registro propio Y en usuarios[])', () => {
  test('borra ambos: su registro propio y su membresía en usuarios[] del dueño', async () => {
    clienteService.clientes[String(INVITADO)] = { sheetId: 'sheet-propio-legacy', ownerId: OWNER, usuarios: [] };

    const resultado = await clienteService.eliminarCliente(INVITADO);

    expect(resultado).toBe(true);
    expect(clienteService.clientes[String(INVITADO)]).toBeUndefined();
    expect(clienteService.clientes[OWNER].usuarios).not.toContain(INVITADO);
  });
});
