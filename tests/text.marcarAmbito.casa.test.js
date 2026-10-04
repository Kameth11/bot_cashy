// marcarAmbito con casas compartidas: detección real (personal-nlp.service sin
// mockear) y casa.service simulado.

jest.mock('../src/lib/telegraf', () => ({
  bot: { on: jest.fn(), command: jest.fn(), use: jest.fn(), hears: jest.fn(), action: jest.fn(), catch: jest.fn() },
}));
jest.mock('../src/config', () => ({
  METODOS_VALIDOS: ['efectivo', 'transferencia', 'tarjeta'],
  COMANDOS_INGRESO: ['consulta', 'servicio'],
  COMANDOS_EGRESO: ['gasto'],
  MAX_TEXT_LENGTH: 1000, MAX_DESCRIPCION_LENGTH: 120, MAX_MOVIMIENTO_MONTO: 1000000000, MAX_COTIZACION_DOLAR: 100000,
  AUTHORIZED_USER_ID: 1111, ALLOWED_EMAILS: [], CODIGO_EXPIRACION_HORAS: 24, DASHBOARD_URL: null,
}));
jest.mock('../src/services/cliente.service', () => ({
  get clientes() { return { '2222': { email: 'o@t.com', sheetId: 's', usuarios: [3333], permisos: {} } }; },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));
jest.mock('../src/services/quick_nlp.service', () => ({ ...jest.requireActual('../src/services/quick_nlp.service'), quickParse: jest.fn() }));
jest.mock('../src/services/gemini.service', () => ({ canAttemptRemoteNlp: jest.fn(() => false), parseMessage: jest.fn() }));
jest.mock('../src/services/openrouter.service', () => ({ canAttemptFullIA: jest.fn(() => false), parseMessage: jest.fn() }));
jest.mock('../src/handlers/nlp', () => ({ handleNLPIntent: jest.fn() }));
jest.mock('../src/handlers/nlp-confirm', () => ({ actualizarCampoNlp: jest.fn(), crearMensajeConfirmacion: jest.fn(), discardButtons: jest.fn() }));
jest.mock('../src/handlers/commands/salir', () => ({ procesarConfirmacionSalir: jest.fn() }));
jest.mock('../src/services/registration.service', () => ({ handlePendingRegistration: jest.fn() }));
jest.mock('../src/services/personal.service', () => ({
  leerPreferencias: jest.fn().mockResolvedValue({}),
  obtenerViajeActivo: jest.fn().mockResolvedValue(null),
  correspondeAlViaje: jest.fn().mockReturnValue(false),
  fechaHoyStr: jest.fn().mockReturnValue('01/01/2026'),
}));
jest.mock('../src/services/casa.service', () => ({
  listarMisCasas: jest.fn(),
  listarMiembros: jest.fn(),
}));

const personalService = require('../src/services/personal.service');
const casaService = require('../src/services/casa.service');
const { marcarAmbito } = require('../src/handlers/text');

const CASAS = [
  { casaId: 'casa_1', ownerId: '2222', nombre: 'Casa', activa: true },
  { casaId: 'casa_2', ownerId: '2222', nombre: 'Casa Dinamarca' },
];
const MIEMBROS = [
  { id: 'm1', userId: '2222', nombre: 'Ana' },
  { id: 'm2', userId: '4444', nombre: 'Beto' },
];
const gasto = (extra = {}) => ({ intent: 'registrar_movimiento', entities: { tipo: 'gasto', descripcion: 'super', monto: 45000, categoria: 'insumos', ...extra } });

beforeEach(() => {
  jest.clearAllMocks();
  personalService.leerPreferencias.mockResolvedValue({});
  casaService.listarMisCasas.mockReturnValue(CASAS);
  casaService.listarMiembros.mockResolvedValue(MIEMBROS);
});

describe('marcarAmbito con casas', () => {
  test('"super 45000 casa" va a la casa activa; paga quien escribe, reparto entre todos', async () => {
    const { entities } = await marcarAmbito(2222, 'super 45000 casa', gasto());
    expect(entities).toMatchObject({
      ambito: 'casa', casaId: 'casa_1', casaNombre: 'Casa', pagoPorId: 'm1', pagoPorNombre: 'Ana', repartoIds: null,
    });
    expect(entities.miembrosCasa).toEqual([{ id: 'm1', nombre: 'Ana' }, { id: 'm2', nombre: 'Beto' }]);
    expect(entities.categoria).toBe('supermercado'); // categoría del hogar, no la del consultorio
    expect(entities.categoriaConsultorio).toBe('insumos');
    expect(entities.casasDisponibles).toEqual([{ casaId: 'casa_1', nombre: 'Casa' }, { casaId: 'casa_2', nombre: 'Casa Dinamarca' }]);
  });

  test('nombrando la otra casa', async () => {
    const { entities } = await marcarAmbito(2222, 'super 45000 casa dinamarca', gasto());
    expect(entities).toMatchObject({ ambito: 'casa', casaId: 'casa_2', casaNombre: 'Casa Dinamarca' });
    expect(casaService.listarMiembros).toHaveBeenCalledWith(2222, 'casa_2');
  });

  test('extrae quién pagó y entre quiénes', async () => {
    const { entities } = await marcarAmbito(2222, 'cena 30000 casa pagó Beto entre Ana y Beto', gasto({ descripcion: 'cena', monto: 30000 }));
    expect(entities).toMatchObject({ pagoPorId: 'm2', pagoPorNombre: 'Beto', repartoIds: ['m1', 'm2'], repartoNombres: ['Ana', 'Beto'] });
  });

  test('un nombre desconocido en el reparto avisa y reparte entre todos', async () => {
    const { entities } = await marcarAmbito(2222, 'cena casa entre Ana y Zoe', gasto());
    expect(entities.repartoIds).toBeNull();
    expect(entities.avisoReparto).toMatch(/zoe/i);
  });

  test('un ingreso NUNCA va a la casa', async () => {
    const { entities } = await marcarAmbito(2222, 'cobré 10000 casa', gasto({ tipo: 'ingreso' }));
    expect(entities.ambito).not.toBe('casa');
    expect(casaService.listarMiembros).not.toHaveBeenCalled();
  });

  test('sin señal de casa, el gasto sigue su camino de siempre', async () => {
    const { entities } = await marcarAmbito(2222, 'super 45000', gasto());
    expect(entities.ambito).toBe('personal');
    expect(entities.casasDisponibles).toHaveLength(2); // pero el selector ofrece las casas
  });

  test('sin casas no cambia nada: "luz de casa" sigue siendo personal y no hay casasDisponibles', async () => {
    casaService.listarMisCasas.mockReturnValue([]);
    const { entities } = await marcarAmbito(2222, 'luz de casa 80000', gasto({ descripcion: 'luz' }));
    expect(entities.ambito).toBe('personal');
    expect(entities.casasDisponibles).toBeUndefined();
  });

  test('una foto de comprobante (permitirCasa:false) no va a casa', async () => {
    const { entities } = await marcarAmbito(2222, 'super casa', gasto(), { permitirCasa: false });
    expect(entities.ambito).not.toBe('casa');
    expect(casaService.listarMisCasas).not.toHaveBeenCalled();
  });

  test('si la casa no se puede leer, el gasto no se pierde: cae al ámbito sin casas', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    casaService.listarMiembros.mockRejectedValue(new Error('sheet caído'));
    const { entities } = await marcarAmbito(2222, 'luz de casa 80000', gasto({ descripcion: 'luz' }));
    expect(entities.ambito).toBe('personal');
  });

  test('si falla la lectura de casas, el movimiento se procesa igual', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    casaService.listarMisCasas.mockImplementation(() => { throw new Error('boom'); });
    const { entities } = await marcarAmbito(2222, 'super 45000', gasto());
    expect(entities.ambito).toBe('personal');
  });

  test('un invitado (sin ámbito personal ni casas) sigue forzado a consultorio', async () => {
    const { entities } = await marcarAmbito(3333, 'super 45000 casa', gasto());
    expect(entities.ambito).toBe('consultorio');
    expect(casaService.listarMisCasas).not.toHaveBeenCalled();
  });

  test('preferencia aprendida casa:<id> se respeta para términos ambiguos', async () => {
    personalService.leerPreferencias.mockResolvedValue({ luz: 'casa:casa_2' });
    const { entities } = await marcarAmbito(2222, 'luz 80000', gasto({ descripcion: 'luz' }));
    expect(entities).toMatchObject({ ambito: 'casa', casaId: 'casa_2' });
  });
});
