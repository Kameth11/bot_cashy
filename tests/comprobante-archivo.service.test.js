// Archivo original de los comprobantes: bucket privado de Supabase con
// prefijo por tenant, o file_id de Telegram si no hay Supabase.

const mockStorage = { upload: jest.fn(), download: jest.fn() };
const mockUpsert = jest.fn();
let mockDisponible = true;
let mockBucketError = null;
let mockTablaError = null;

jest.mock('../src/lib/supabase', () => ({
  isAvailable: () => mockDisponible,
  getSupabase: () => ({
    from: () => ({ select: async () => ({ error: mockTablaError }) }),
    storage: {
      getBucket: async () => ({ error: mockBucketError }),
      from: () => mockStorage,
    },
  }),
}));
jest.mock('../src/lib/tenant-db', () => ({
  forTenant: () => ({ from: () => ({ upsert: mockUpsert, update: () => ({ eq: async () => ({ error: null }) }) }) }),
}));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn(async () => 'tenant-1') }));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockGetFileLink = jest.fn(async () => ({ href: 'http://tg/file' }));
jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { getFileLink: (...a) => mockGetFileLink(...a) } } }));
jest.mock('axios', () => ({ get: jest.fn(async () => ({ data: Buffer.from('TG') })) }));

const svc = require('../src/services/comprobante-archivo.service');

beforeEach(() => {
  jest.clearAllMocks();
  mockDisponible = true;
  mockBucketError = null;
  mockTablaError = null;
  svc._resetCapacidades();
  mockStorage.upload.mockResolvedValue({ error: null });
  mockUpsert.mockResolvedValue({ error: null });
});

test('pathArchivo: prefijo de tenant, mes y extensión según el tipo', () => {
  expect(svc.pathArchivo('t1', 'comp_1', 'application/pdf', new Date(2026, 8, 30))).toBe('t1/2026-09/comp_1.pdf');
  expect(svc.pathArchivo('t1', 'comp_1', 'image/jpeg', new Date(2026, 0, 2))).toBe('t1/2026-01/comp_1.jpg');
});

test('recordar/tomar: el archivo se usa una sola vez', () => {
  svc.recordarArchivo('comp_1', { buffer: Buffer.from('x'), mimeType: 'image/jpeg' });
  expect(svc.tomarArchivo('comp_1')).toMatchObject({ mimeType: 'image/jpeg' });
  expect(svc.tomarArchivo('comp_1')).toBeNull();
});

test('sube al bucket y devuelve sb:<path>', async () => {
  const ref = await svc.subirArchivo(2222, 'comp_1', { buffer: Buffer.from('x'), mimeType: 'image/jpeg' });
  expect(ref).toMatch(/^sb:tenant-1\/\d{4}-\d{2}\/comp_1\.jpg$/);
  expect(mockStorage.upload).toHaveBeenCalledWith(ref.slice(3), expect.any(Buffer), expect.objectContaining({ contentType: 'image/jpeg' }));
});

test('sin Supabase o sin bucket no sube (queda el file_id de Telegram)', async () => {
  mockDisponible = false;
  expect(await svc.subirArchivo(2222, 'comp_1', { buffer: Buffer.from('x'), mimeType: 'image/jpeg' })).toBeNull();

  mockDisponible = true;
  svc._resetCapacidades();
  mockBucketError = { message: 'Bucket not found' };
  expect(await svc.subirArchivo(2222, 'comp_1', { buffer: Buffer.from('x'), mimeType: 'image/jpeg' })).toBeNull();
  expect(mockStorage.upload).not.toHaveBeenCalled();
});

test('si la subida falla devuelve null', async () => {
  mockStorage.upload.mockResolvedValue({ error: { message: 'boom' } });
  expect(await svc.subirArchivo(2222, 'comp_1', { buffer: Buffer.from('x'), mimeType: 'image/jpeg' })).toBeNull();
});

test('descarga sb: solo si el path es del tenant de quien pide', async () => {
  mockStorage.download.mockResolvedValue({ data: { arrayBuffer: async () => new TextEncoder().encode('SB').buffer }, error: null });
  expect((await svc.descargarArchivo(2222, 'sb:tenant-1/2026-09/comp_1.jpg')).toString()).toBe('SB');
  expect(await svc.descargarArchivo(2222, 'sb:otro-tenant/2026-09/comp_1.jpg')).toBeNull();
  expect(mockStorage.download).toHaveBeenCalledTimes(1);
});

test('descarga tg: por la API de Telegram', async () => {
  expect((await svc.descargarArchivo(2222, 'tg:file-123')).toString()).toBe('TG');
  expect(mockGetFileLink).toHaveBeenCalledWith('file-123');
});

test('copia en Supabase con fechas ISO y los ítems', async () => {
  const ok = await svc.guardarEnSupabase(2222, {
    id: 'comp_1', tipo: 'factura', ambito: 'consultorio', emisor: 'Dental Sur', tipoDocumento: 'factura', letra: 'B',
    fechaEmision: '01/09/2026', fechaVencimiento: '15/10/2026', total: 45300, items: [{ descripcion: 'Guantes' }],
    idMovimiento: 'mov_1', cargadoPor: 2222,
  });
  expect(ok).toBe(true);
  expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
    legacy_id: 'comp_1', tipo_comprobante: 'factura B', fecha_emision: '2026-09-01', fecha_vencimiento: '2026-10-15',
    total: 45300, items: [{ descripcion: 'Guantes' }], id_movimiento: 'mov_1', cargado_por: 2222,
  }), { onConflict: 'tenant_id,legacy_id' });
});

test('sin la tabla (migración 011 sin correr) no intenta escribir', async () => {
  mockTablaError = { message: 'relation "comprobantes" does not exist' };
  expect(await svc.guardarEnSupabase(2222, { id: 'comp_1' })).toBe(false);
  expect(mockUpsert).not.toHaveBeenCalled();
});
