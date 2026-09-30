// Al guardar, el archivo pendiente se sube a Storage (si hay) y el
// comprobante se registra en la pestaña y en Supabase. Un movimiento que se
// guardó en un paso posterior completa el vínculo después.

jest.mock('../src/lib/telegraf', () => ({ bot: { action: jest.fn(), on: jest.fn() } }));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/services/command.service', () => ({}));
jest.mock('../src/services/comprobante.service', () => ({
  registrarComprobante: jest.fn(async (u, c) => c.id),
  vincularMovimiento: jest.fn(async () => true),
}));
jest.mock('../src/services/comprobante-archivo.service', () => ({
  tomarArchivo: jest.fn(),
  subirArchivo: jest.fn(),
  guardarEnSupabase: jest.fn(async () => true),
  vincularMovimientoEnSupabase: jest.fn(async () => {}),
}));

const comprobanteService = require('../src/services/comprobante.service');
const archivoService = require('../src/services/comprobante-archivo.service');
const { registrarComprobanteDesdeEntities } = require('../src/handlers/comprobante');

const entities = () => ({
  monto: -45300, moneda: 'Pesos', ambito: 'consultorio',
  comprobante: { id: 'comp_1', tipo: 'factura', emisor: 'Dental Sur', total: 45300, archivo: 'tg:f1', mimeType: 'image/jpeg' },
});

beforeEach(() => jest.clearAllMocks());

test('con archivo pendiente y bucket: guarda la referencia sb:', async () => {
  archivoService.tomarArchivo.mockReturnValue({ buffer: Buffer.from('x'), mimeType: 'image/jpeg' });
  archivoService.subirArchivo.mockResolvedValue('sb:t1/2026-09/comp_1.jpg');

  await registrarComprobanteDesdeEntities(2222, entities(), { idMovimiento: 'mov_1' });

  expect(comprobanteService.registrarComprobante).toHaveBeenCalledWith(2222, expect.objectContaining({
    archivo: 'sb:t1/2026-09/comp_1.jpg', total: 45300, idMovimiento: 'mov_1', ambito: 'consultorio',
  }));
  expect(archivoService.guardarEnSupabase).toHaveBeenCalledWith(2222, expect.objectContaining({ id: 'comp_1', archivo: 'sb:t1/2026-09/comp_1.jpg' }));
});

test('si no se pudo subir, queda el file_id de Telegram', async () => {
  archivoService.tomarArchivo.mockReturnValue({ buffer: Buffer.from('x'), mimeType: 'image/jpeg' });
  archivoService.subirArchivo.mockResolvedValue(null);
  await registrarComprobanteDesdeEntities(2222, entities());
  expect(comprobanteService.registrarComprobante).toHaveBeenCalledWith(2222, expect.objectContaining({ archivo: 'tg:f1' }));
});

test('un error al registrar no rompe el guardado del movimiento', async () => {
  comprobanteService.registrarComprobante.mockRejectedValueOnce(new Error('quota'));
  await expect(registrarComprobanteDesdeEntities(2222, entities())).resolves.toBeNull();
});

describe('movimiento guardado en un paso posterior (método de pago / cotización)', () => {
  test('guardarMovimiento con ReferenciaId comp:<id> completa el vínculo', async () => {
    jest.resetModules();
    jest.doMock('../src/services/db.service', () => ({ addRow: jest.fn(async () => ({})) }));
    jest.doMock('../src/auth', () => ({ obtenerClientePorUserId: () => null }));
    const mockVincular = jest.fn(async () => true);
    const mockVincularSb = jest.fn(async () => {});
    jest.doMock('../src/services/comprobante.service', () => ({ vincularMovimiento: mockVincular }));
    jest.doMock('../src/services/comprobante-archivo.service', () => ({ vincularMovimientoEnSupabase: mockVincularSb }));
    const { guardarMovimiento } = require('../src/services/movimiento.service');

    const r = await guardarMovimiento(2222, {
      descripcion: 'Insumos', monto: -45300, tipo: 'Egreso', moneda: 'Pesos', metodoPago: 'tarjeta',
      montoPesos: 45300, referenciaId: 'comp:comp_1',
    });
    await new Promise(setImmediate);
    expect(mockVincular).toHaveBeenCalledWith(2222, 'comp_1', r.idUnico);
    expect(mockVincularSb).toHaveBeenCalledWith(2222, 'comp_1', r.idUnico);
  });
});
