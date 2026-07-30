// Alta por código de invitación.
//
// Este flujo no tenía cobertura y es sensible: da de alta usuarios nuevos y
// convive con el gate de aprobación por `tenant_requests`.

jest.mock('../src/services/tenant-request.service', () => ({
  registrarInvitacionAprobada: jest.fn(async () => ({ ok: true, data: {} })),
}));

jest.mock('../src/services/cliente.service', () => ({
  clientes: {},
  guardarClientes: jest.fn(async () => {}),
}));

const tenantRequestService = require('../src/services/tenant-request.service');
const clienteService = require('../src/services/cliente.service');
const state = require('../src/state');
const { beginInviteRegistration, createInviteCode } = require('../src/services/invite.service');

const OWNER = 1000;
const INVITADO = 2000;

beforeEach(() => {
  state.pendingCodigos.clear();
  state.pendingRegistros.clear();
  state.pendingIntentosCodigo.clear();
  // El owner existe; el invitado todavía no.
  Object.keys(clienteService.clientes).forEach(k => delete clienteService.clientes[k]);
  clienteService.clientes[OWNER] = { sheetId: 'sheet-owner', usuarios: [] };
});

describe('beginInviteRegistration — código válido', () => {
  test('deja al invitado en el paso de configurar SU propio sheet', async () => {
    const codigo = createInviteCode(OWNER);
    const res = await beginInviteRegistration(INVITADO, codigo);

    expect(res.message).toMatch(/Código válido/);
    expect(res.message).toMatch(/tu propio Google Sheet/i);

    const registro = state.pendingRegistros.get(INVITADO);
    expect(registro).toMatchObject({ step: 'sheetId', ownerId: OWNER });
  });

  test('consume el código para que no se pueda reusar', async () => {
    const codigo = createInviteCode(OWNER);
    await beginInviteRegistration(INVITADO, codigo);

    expect(state.pendingCodigos.has(codigo)).toBe(false);

    const segundo = await beginInviteRegistration(3000, codigo);
    expect(segundo.message).toMatch(/inválido o expirado/i);
  });

  test('acepta el código en minúsculas y con espacios', async () => {
    const codigo = createInviteCode(OWNER);
    const res = await beginInviteRegistration(INVITADO, `  ${codigo.toLowerCase()}  `);
    expect(res.message).toMatch(/Código válido/);
  });

  test('registra el alta como solicitud aprobada (no saltea la auditoría)', async () => {
    const codigo = createInviteCode(OWNER);
    await beginInviteRegistration(INVITADO, codigo);

    expect(tenantRequestService.registrarInvitacionAprobada)
      .toHaveBeenCalledWith(INVITADO, OWNER);
  });

  test('si Supabase no está, el alta sigue funcionando igual', async () => {
    tenantRequestService.registrarInvitacionAprobada.mockResolvedValueOnce({
      ok: false, error: 'Supabase no disponible',
    });

    const codigo = createInviteCode(OWNER);
    const res = await beginInviteRegistration(INVITADO, codigo);

    expect(res.message).toMatch(/Código válido/);
    expect(state.pendingRegistros.get(INVITADO)).toMatchObject({ step: 'sheetId' });
  });
});

describe('beginInviteRegistration — casos que debe rechazar', () => {
  test('código inexistente', async () => {
    const res = await beginInviteRegistration(INVITADO, 'NOEXISTE');
    expect(res.message).toMatch(/inválido o expirado/i);
    expect(state.pendingRegistros.has(INVITADO)).toBe(false);
  });

  test('código expirado', async () => {
    const codigo = createInviteCode(OWNER);
    // Se lo envejece más allá de CODIGO_EXPIRACION_HORAS.
    state.pendingCodigos.set(codigo, {
      ownerId: OWNER,
      createdAt: Date.now() - 1000 * 60 * 60 * 48,
    });

    const res = await beginInviteRegistration(INVITADO, codigo);
    expect(res.message).toMatch(/expirado/i);
    expect(state.pendingCodigos.has(codigo)).toBe(false);
  });

  test('el owner ya no existe', async () => {
    const codigo = createInviteCode(OWNER);
    delete clienteService.clientes[OWNER];

    const res = await beginInviteRegistration(INVITADO, codigo);
    expect(res.message).toMatch(/owner ya no existe/i);
  });

  test('el invitado ya tiene cuenta propia', async () => {
    clienteService.clientes[INVITADO] = { sheetId: 'sheet-propio', usuarios: [] };
    const codigo = createInviteCode(OWNER);

    const res = await beginInviteRegistration(INVITADO, codigo);
    expect(res.message).toMatch(/Ya tienes una cuenta registrada/i);
    expect(tenantRequestService.registrarInvitacionAprobada).not.toHaveBeenCalled();
  });

  test('el invitado ya figura entre los usuarios del owner', async () => {
    clienteService.clientes[OWNER].usuarios = [INVITADO];
    const codigo = createInviteCode(OWNER);

    const res = await beginInviteRegistration(INVITADO, codigo);

    // `obtenerClientePorUserId` ya resuelve a los invitados listados en
    // `usuarios[]`, así que la primera guarda atrapa este caso y la rama de
    // "Ya estás autorizado" que hay más abajo queda como defensa redundante.
    // Lo importante es que no se re-dé de alta ni se consuma el código.
    expect(res.message).toMatch(/Ya tienes una cuenta registrada/i);
    expect(state.pendingRegistros.has(INVITADO)).toBe(false);
    expect(state.pendingCodigos.has(codigo)).toBe(true);
  });

  test('corta tras demasiados intentos fallidos', async () => {
    const { MAX_INTENTOS_CODIGO } = require('../src/config');

    let ultimo;
    for (let i = 0; i <= MAX_INTENTOS_CODIGO; i++) {
      ultimo = await beginInviteRegistration(INVITADO, 'MALMAL');
    }
    expect(ultimo.message).toMatch(/Demasiados intentos/i);
  });
});
