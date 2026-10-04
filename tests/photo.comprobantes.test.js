// Fotos/PDFs: la IA clasifica (agenda / factura / transferencia) y se deriva
// al flujo correcto, con el permiso de cada uno. Ver PLAN_COMPROBANTES.md.

jest.mock('axios', () => ({ get: jest.fn() }));

jest.mock('../src/lib/telegraf', () => ({
  bot: {
    on: (event, handler) => { global.__docHandlers[event] = handler; },
    action: (name, handler) => { global.__docActions[name] = handler; },
    command: jest.fn(), use: jest.fn(), hears: jest.fn(), catch: jest.fn(),
  },
}));

jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  MAX_PHOTO_SIZE_BYTES: 10 * 1024 * 1024,
  MAX_TURNOS_POR_IMAGEN: 120,
}));

jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': {
        email: 'owner@test.com',
        sheetId: 'sheet-owner',
        usuarios: [3333, 4444],
        permisos: {
          '3333': ['ver_movimientos', 'cargar_movimientos'], // administración, sin agenda
          '4444': ['ver_agenda', 'editar_agenda'], // recepción, sin plata
        },
      },
    };
  },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

jest.mock('../src/services/vision.service', () => ({
  procesarFotoAgenda: jest.fn().mockResolvedValue({ turnos: [] }),
}));

jest.mock('../src/services/comprobante-vision.service', () => ({
  clasificarDocumento: jest.fn(),
  extraerFactura: jest.fn(),
}));

jest.mock('../src/services/sheet.service', () => ({ getDocCliente: jest.fn(), invalidateCache: jest.fn() }));

jest.mock('../src/services/comprobante.service', () => ({
  ...jest.requireActual('../src/services/comprobante.service'),
  buscarDuplicado: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/services/agenda.service', () => ({
  resolverProfesional: jest.fn().mockReturnValue(null),
  obtenerConsultorioMap: jest.fn().mockResolvedValue({}),
}));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn().mockResolvedValue(null) }));
jest.mock('../src/handlers/actions', () => ({ confirmButtons: jest.fn().mockReturnValue({}) }));
jest.mock('../src/handlers/guards', () => ({ tieneProcesoPendiente: jest.fn().mockReturnValue(false) }));
jest.mock('../src/handlers/text', () => ({
  marcarAmbito: jest.fn(async (userId, text, result) => ({
    ...result, entities: { ...result.entities, ambito: 'consultorio', textoOriginal: text },
  })),
}));
jest.mock('../src/handlers/nlp-confirm', () => ({ mostrarConfirmacion: jest.fn().mockResolvedValue(true) }));

global.__docHandlers = {};
global.__docActions = {};

const axios = require('axios');
const state = require('../src/state');
const { procesarFotoAgenda } = require('../src/services/vision.service');
const { clasificarDocumento, extraerFactura } = require('../src/services/comprobante-vision.service');
const { mostrarConfirmacion } = require('../src/handlers/nlp-confirm');
const { marcarAmbito } = require('../src/handlers/text');
const { tipoPorCaption } = require('../src/handlers/photo');

const FACTURA = {
  tipoDocumento: 'factura', letra: 'B', emisor: 'Dental Sur', cuit: '30-71234567-8', numero: '0003-00001234',
  fechaEmision: '01/09/2026', fechaVencimiento: null, total: 45300, moneda: 'Pesos', metodoPago: 'tarjeta',
  pagado: true, rubro: 'insumos odontológicos', descripcion: 'Insumos - Dental Sur', categoria: 'insumos', items: [],
};

function ctxFoto(userId, caption) {
  return {
    from: { id: userId },
    message: { photo: [{ file_id: 'f1', file_size: 1000 }], caption },
    telegram: { getFileLink: jest.fn().mockResolvedValue({ href: 'http://fake/file' }) },
    reply: jest.fn().mockResolvedValue(true),
    answerCbQuery: jest.fn().mockResolvedValue(true),
    editMessageText: jest.fn().mockResolvedValue(true),
  };
}

const DENEGADO = expect.stringContaining('No tenés permiso');

beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockResolvedValue({ data: Buffer.from('imagen') });
  extraerFactura.mockResolvedValue({ factura: FACTURA });
  state.pendingDocumentoTipo.delete(2222);
});

test('tipoPorCaption reconoce pistas del usuario', () => {
  expect(tipoPorCaption('factura de luz')).toBe('factura');
  expect(tipoPorCaption('agenda de mañana')).toBe('agenda');
  expect(tipoPorCaption('me pagó Juan')).toBe('transferencia');
  expect(tipoPorCaption('')).toBeNull();
});

test('dueño manda una factura → se lee y va a la confirmación con el vínculo al comprobante', async () => {
  clasificarDocumento.mockResolvedValue({ tipo: 'factura', confianza: 0.95 });
  const ctx = ctxFoto(2222);
  await global.__docHandlers.photo(ctx);

  expect(procesarFotoAgenda).not.toHaveBeenCalled();
  expect(extraerFactura).toHaveBeenCalled();
  // Las fotos de comprobantes no van a CASA: se pide explícitamente que no la considere.
  expect(marcarAmbito).toHaveBeenCalledWith(2222, expect.stringContaining('insumos'), expect.anything(), { permitirCasa: false });
  const [, entities] = mostrarConfirmacion.mock.calls[0];
  expect(entities).toMatchObject({
    tipo: 'gasto', monto: 45300, proveedorNombre: 'Dental Sur', categoria: 'insumos', estado: 'Cobrado',
    referenciaId: expect.stringMatching(/^comp:comp_/),
    comprobante: { cuit: '30-71234567-8', archivo: 'tg:f1', hash: expect.any(String) },
  });
});

test('dueño manda una agenda → flujo de agenda de siempre', async () => {
  clasificarDocumento.mockResolvedValue({ tipo: 'agenda', confianza: 0.9 });
  await global.__docHandlers.photo(ctxFoto(2222));
  expect(procesarFotoAgenda).toHaveBeenCalled();
  expect(extraerFactura).not.toHaveBeenCalled();
});

test('con caption "factura" no gasta la llamada de clasificación', async () => {
  await global.__docHandlers.photo(ctxFoto(2222, 'factura del laboratorio'));
  expect(clasificarDocumento).not.toHaveBeenCalled();
  expect(extraerFactura).toHaveBeenCalled();
});

test('si la clasificación falla, se cae a agenda (comportamiento histórico)', async () => {
  clasificarDocumento.mockResolvedValue({ error: 'vision_no_configurada' });
  await global.__docHandlers.photo(ctxFoto(2222));
  expect(procesarFotoAgenda).toHaveBeenCalled();
});

test('si la IA duda, pregunta con botones y deriva según la elección', async () => {
  clasificarDocumento.mockResolvedValue({ tipo: 'otro', confianza: 0.3 });
  const ctx = ctxFoto(2222);
  await global.__docHandlers.photo(ctx);
  expect(ctx.reply).toHaveBeenLastCalledWith(expect.stringContaining('No estoy seguro'), expect.anything());
  expect(state.pendingDocumentoTipo.has(2222)).toBe(true);

  await global.__docActions.doc_tipo_factura(ctx);
  expect(state.pendingDocumentoTipo.has(2222)).toBe(false);
  expect(extraerFactura).toHaveBeenCalled();
  expect(mostrarConfirmacion).toHaveBeenCalled();
});

test('administración (solo cargar_movimientos) no puede cargar una agenda', async () => {
  clasificarDocumento.mockResolvedValue({ tipo: 'agenda', confianza: 0.9 });
  const ctx = ctxFoto(3333);
  await global.__docHandlers.photo(ctx);
  expect(ctx.reply).toHaveBeenCalledWith(DENEGADO);
  expect(procesarFotoAgenda).not.toHaveBeenCalled();
});

test('administración sí puede cargar una factura', async () => {
  clasificarDocumento.mockResolvedValue({ tipo: 'factura', confianza: 0.9 });
  await global.__docHandlers.photo(ctxFoto(3333));
  expect(mostrarConfirmacion).toHaveBeenCalled();
});

test('recepción (solo editar_agenda) sigue con agenda directo, sin clasificar ni leer facturas', async () => {
  await global.__docHandlers.photo(ctxFoto(4444));
  expect(clasificarDocumento).not.toHaveBeenCalled();
  expect(extraerFactura).not.toHaveBeenCalled();
  expect(procesarFotoAgenda).toHaveBeenCalled();
});

test('PDF por archivo se acepta; otros formatos no', async () => {
  clasificarDocumento.mockResolvedValue({ tipo: 'factura', confianza: 0.9 });
  const ctx = ctxFoto(2222);
  ctx.message = { document: { file_id: 'd1', file_size: 2000, mime_type: 'application/pdf' } };
  await global.__docHandlers.document(ctx);
  expect(extraerFactura).toHaveBeenCalledWith(expect.any(Buffer), 'application/pdf');
  expect(mostrarConfirmacion.mock.calls[0][1].comprobante.archivo).toBe('tg:d1');

  const ctx2 = ctxFoto(2222);
  ctx2.message = { document: { file_id: 'd2', mime_type: 'application/zip' } };
  await global.__docHandlers.document(ctx2);
  expect(ctx2.reply).toHaveBeenCalledWith(expect.stringContaining('fotos y PDFs'));
});

test('factura sin total legible → pide foto más clara, no confirma', async () => {
  clasificarDocumento.mockResolvedValue({ tipo: 'factura', confianza: 0.9 });
  extraerFactura.mockResolvedValue({ factura: { ...FACTURA, total: null } });
  const ctx = ctxFoto(2222);
  await global.__docHandlers.photo(ctx);
  expect(mostrarConfirmacion).not.toHaveBeenCalled();
  expect(ctx.reply).toHaveBeenLastCalledWith(expect.stringContaining('no encontré el total'), expect.anything());
});
