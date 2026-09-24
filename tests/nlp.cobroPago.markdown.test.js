// Ítem 3.4: el nombre del paciente/proveedor (entities.pacienteNombre /
// entities.proveedorNombre, texto libre reconocido por el NLP) iba sin
// escapar en el mensaje de confirmación de cobro/pago parcial con deuda.

jest.mock('../src/lib/telegraf', () => ({ bot: { on: jest.fn(), command: jest.fn(), use: jest.fn(), hears: jest.fn(), action: jest.fn(), catch: jest.fn() } }));

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  DASHBOARD_URL: null,
}));

jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return { '2222': { sheetId: 's', usuarios: [], permisos: {} } }; // owner: todos los permisos
  },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

jest.mock('../src/services/command.service', () => ({
  guardarMovimiento: jest.fn().mockResolvedValue({ mensaje: 'ok' }),
}));
jest.mock('../src/handlers/commands/sheet', () => ({ handleSheetCommand: jest.fn() }));
jest.mock('../src/handlers/actions', () => ({ confirmButtons: jest.fn().mockReturnValue({}) }));
jest.mock('../src/handlers/cobrar-confirm', () => ({ mostrarCobrar: jest.fn() }));
jest.mock('../src/handlers/nlp-confirm', () => ({ mostrarConfirmacion: jest.fn() }));

const cmd = require('../src/services/command.service');
const { handleNLPIntent } = require('../src/handlers/nlp');

function ctxFor(userId) {
  return { from: { id: userId }, reply: jest.fn().mockResolvedValue(true) };
}

beforeEach(() => jest.clearAllMocks());

describe('cobro_parcial_con_deuda / pago_parcial_con_deuda — escapan el nombre en el mensaje', () => {
  test('pacienteNombre con "_" queda escapado en el resumen de cobro parcial', async () => {
    const ctx = ctxFor(2222);
    await handleNLPIntent(ctx, {
      intent: 'cobro_parcial_con_deuda',
      entities: { montoCobrado: 15000, montoDeuda: 5000, pacienteNombre: 'Juan_Perez' },
    });

    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain('Juan\\_Perez');
    expect(msg).not.toContain('— Juan_Perez');
  });

  test('proveedorNombre con "*" queda escapado en el resumen de pago parcial', async () => {
    const ctx = ctxFor(2222);
    await handleNLPIntent(ctx, {
      intent: 'pago_parcial_con_deuda',
      entities: { montoPagado: 15000, montoDeuda: 5000, proveedorNombre: 'Dental *Sur*' },
    });

    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain('Dental \\*Sur\\*');
    expect(msg).not.toContain('— Dental *Sur*');
  });
});
