const {
  PERMISOS,
  PRESETS,
  DEFAULT_PERMISOS,
  ADMIN_PERMISOS,
  puede,
  validarPermisos,
  detectarPreset,
} = require('../src/auth/permisos');

describe('permisos constants', () => {
  test('PERMISOS tiene los 6 permisos esperados', () => {
    expect(PERMISOS).toHaveLength(6);
    expect(PERMISOS).toContain('ver_agenda');
    expect(PERMISOS).toContain('ver_balance');
    expect(PERMISOS).toContain('cargar_movimientos');
  });

  test('ADMIN_PERMISOS contiene todos los permisos', () => {
    expect(ADMIN_PERMISOS.sort()).toEqual([...PERMISOS].sort());
  });

  test('DEFAULT_PERMISOS solo tiene ver_agenda', () => {
    expect(DEFAULT_PERMISOS).toEqual(['ver_agenda']);
  });
});

describe('puede()', () => {
  test('retorna true si el permiso está en el array', () => {
    expect(puede(['ver_agenda', 'ver_balance'], 'ver_balance')).toBe(true);
  });

  test('retorna false si el permiso no está', () => {
    expect(puede(['ver_agenda'], 'ver_balance')).toBe(false);
  });

  test('retorna false con array vacío', () => {
    expect(puede([], 'ver_agenda')).toBe(false);
  });

  test('retorna false con valor no-array', () => {
    expect(puede(null, 'ver_agenda')).toBe(false);
    expect(puede(undefined, 'ver_agenda')).toBe(false);
  });
});

describe('validarPermisos()', () => {
  test('acepta array de permisos conocidos', () => {
    expect(validarPermisos(['ver_agenda', 'ver_balance'])).toBe(true);
  });

  test('acepta array vacío', () => {
    expect(validarPermisos([])).toBe(true);
  });

  test('rechaza permisos desconocidos', () => {
    expect(validarPermisos(['ver_agenda', 'inventado'])).toBe(false);
  });

  test('rechaza no-array', () => {
    expect(validarPermisos(null)).toBe(false);
    expect(validarPermisos('ver_agenda')).toBe(false);
  });
});

describe('detectarPreset()', () => {
  test('detecta preset odontologo', () => {
    expect(detectarPreset(PRESETS.odontologo)).toBe('odontologo');
  });

  test('detecta preset recepcion', () => {
    expect(detectarPreset(PRESETS.recepcion)).toBe('recepcion');
  });

  test('detecta preset contadora', () => {
    expect(detectarPreset(PRESETS.contadora)).toBe('contadora');
  });

  test('retorna null para array custom', () => {
    expect(detectarPreset(['ver_agenda', 'ver_balance'])).toBeNull();
  });

  test('detecta preset independientemente del orden', () => {
    const shuffled = [...PRESETS.odontologo].reverse();
    expect(detectarPreset(shuffled)).toBe('odontologo');
  });
});

describe('resolverPermisos()', () => {
  // Mockeamos las dependencias para no necesitar DB ni clientes.json
  jest.mock('../src/config', () => ({
    AUTHORIZED_USER_ID: 123,
    ALLOWED_EMAILS: [],
    CODIGO_EXPIRACION_HORAS: 24,
    USE_SUPABASE: false,
    CLIENTES_FILE: '/tmp/clientes_test.json',
  }));

  jest.mock('../src/state', () => ({
    pendingIntentosEmail: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
    pendingIntentosCodigo: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
  }));

  // clienteService mock con dos perfiles: owner (456) con invitado (789)
  jest.mock('../src/services/cliente.service', () => ({
    get clientes() {
      return {
        '456': {
          email: 'owner@test.com',
          usuarios: [789],
          permisos: { '789': ['ver_agenda', 'editar_agenda'] },
        },
      };
    },
    cargarClientes: jest.fn(),
    guardarClientes: jest.fn(),
    getCliente: jest.fn(),
    eliminarCliente: jest.fn(),
    getPermisos: jest.fn(),
    setPermisos: jest.fn(),
  }));

  const { resolverPermisos } = require('../src/auth/index');

  test('admin global (AUTHORIZED_USER_ID) recibe ADMIN_PERMISOS', () => {
    const perms = resolverPermisos(123);
    expect(perms.sort()).toEqual([...ADMIN_PERMISOS].sort());
  });

  test('owner recibe ADMIN_PERMISOS', () => {
    const perms = resolverPermisos(456);
    expect(perms.sort()).toEqual([...ADMIN_PERMISOS].sort());
  });

  test('invitado con permisos asignados los recibe exactos', () => {
    const perms = resolverPermisos(789);
    expect(perms.sort()).toEqual(['editar_agenda', 'ver_agenda']);
  });

  test('usuario desconocido recibe DEFAULT_PERMISOS', () => {
    const perms = resolverPermisos(999);
    expect(perms).toEqual(DEFAULT_PERMISOS);
  });
});
