// Alta en la pestaña Comprobantes (se crea sola la primera vez) y lectura
// para detectar duplicados.

const mockSheet = {
  headerValues: [],
  loadHeaderRow: jest.fn(async () => {}),
  setHeaderRow: jest.fn(async (cols) => { mockSheet.headerValues = cols; }),
  addRow: jest.fn(async () => {}),
  getRows: jest.fn(async () => []),
};
const mockDoc = { sheetsByTitle: {}, addSheet: jest.fn(async () => { mockDoc.sheetsByTitle.Comprobantes = mockSheet; return mockSheet; }) };

jest.mock('../src/services/sheet.service', () => ({ getDocCliente: jest.fn(async () => mockDoc), invalidateCache: jest.fn() }));
jest.mock('../src/lib/write-queue', () => ({ withUserWriteLock: (u, fn) => fn() }));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { registrarComprobante, buscarDuplicado, COLS_COMPROBANTES } = require('../src/services/comprobante.service');

test('crea la pestaña con sus columnas y guarda el comprobante', async () => {
  const id = await registrarComprobante(2222, {
    id: 'comp_1', tipo: 'factura', ambito: 'consultorio', emisor: 'Dental Sur', cuit: '30-71234567-8',
    tipoDocumento: 'factura', letra: 'B', numero: '0003-00001234', total: 45300, moneda: 'Pesos',
    hash: 'abc', archivo: 'tg:f1', mimeType: 'image/jpeg', idMovimiento: 'mov_9',
    items: [{ descripcion: 'Guantes', subtotal: 2000 }], cargadoPor: 2222,
  });

  expect(id).toBe('comp_1');
  expect(mockDoc.addSheet).toHaveBeenCalledWith({ title: 'Comprobantes' });
  expect(mockSheet.setHeaderRow).toHaveBeenCalledWith(COLS_COMPROBANTES);
  expect(mockSheet.addRow).toHaveBeenCalledWith(expect.objectContaining({
    ID_Comprobante: 'comp_1', TipoComprobante: 'factura B', Emisor: 'Dental Sur', Total: 45300,
    Archivo: 'tg:f1', ID_Movimiento: 'mov_9', Items: JSON.stringify([{ descripcion: 'Guantes', subtotal: 2000 }]),
    CargadoPor: '2222',
  }));
});

test('buscarDuplicado lee la pestaña; si falla la lectura no frena la carga', async () => {
  mockSheet.getRows.mockResolvedValueOnce([{ get: (k) => ({ ID_Comprobante: 'comp_1', Hash: 'abc', FechaCarga: '01/09/2026 10:00' })[k] }]);
  expect(await buscarDuplicado(2222, { hash: 'abc' })).toMatchObject({ motivo: 'mismo_archivo', comprobante: { id: 'comp_1' } });

  mockSheet.getRows.mockRejectedValueOnce(new Error('quota'));
  expect(await buscarDuplicado(2222, { hash: 'abc' })).toBeNull();
});

test('vincularMovimiento completa ID_Movimiento solo si estaba vacío', async () => {
  const { vincularMovimiento } = require('../src/services/comprobante.service');
  const fila = { vals: { ID_Comprobante: 'comp_1', ID_Movimiento: '' }, get(k) { return this.vals[k]; }, set(k, v) { this.vals[k] = v; }, save: jest.fn(async () => {}) };
  mockSheet.getRows.mockResolvedValueOnce([fila]);
  expect(await vincularMovimiento(2222, 'comp_1', 'mov_9')).toBe(true);
  expect(fila.vals.ID_Movimiento).toBe('mov_9');
  expect(fila.save).toHaveBeenCalled();

  mockSheet.getRows.mockResolvedValueOnce([fila]);
  expect(await vincularMovimiento(2222, 'comp_1', 'mov_otro')).toBe(false);
  expect(fila.vals.ID_Movimiento).toBe('mov_9');
});
