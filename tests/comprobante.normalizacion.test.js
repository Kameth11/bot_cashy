// Lectura de comprobantes: lo que devuelve Gemini se normaliza antes de
// armar el movimiento (montos argentinos, fechas, CUIT, categoría cerrada).

jest.mock('../src/config', () => ({ GEMINI_API_KEY: null, GEMINI_MODEL: 'x' }));
jest.mock('../src/services/vision.service', () => ({
  getGenAI: jest.fn(), getSharp: jest.fn(), extractJSON: jest.fn(), FALLBACK_MODELS: [],
}));
jest.mock('../src/services/sheet.service', () => ({ getDocCliente: jest.fn(), invalidateCache: jest.fn() }));
jest.mock('../src/lib/write-queue', () => ({ withUserWriteLock: (u, fn) => fn() }));

const {
  parsearMonto, parsearFecha, normalizarCuit, normalizarFactura, normalizarClasificacion, clasificarDocumento,
} = require('../src/services/comprobante-vision.service');
const {
  buscarDuplicadoEn, decidirEstado, facturaAEntities, textoParaAmbito,
} = require('../src/services/comprobante.service');

describe('parsearMonto', () => {
  test.each([
    [45300.5, 45300.5],
    ['45.300,50', 45300.5],
    ['$ 45.300', 45300],
    ['1.234.567', 1234567],
    ['45,300.50', 45300.5],
    ['1500', 1500],
    ['12,5', 12.5],
    [null, null],
    ['', null],
    ['abc', null],
  ])('%p -> %p', (entrada, esperado) => {
    expect(parsearMonto(entrada)).toBe(esperado);
  });
});

describe('parsearFecha', () => {
  test.each([
    ['05/03/2026', '05/03/2026'],
    ['5/3/26', '05/03/2026'],
    ['2026-03-05', '05/03/2026'],
    ['05-03-2026', '05/03/2026'],
    ['32/01/2026', null],
    ['basura', null],
    [null, null],
  ])('%p -> %p', (entrada, esperado) => {
    expect(parsearFecha(entrada)).toBe(esperado);
  });
});

test('normalizarCuit formatea 11 dígitos y descarta el resto', () => {
  expect(normalizarCuit('30712345678')).toBe('30-71234567-8');
  expect(normalizarCuit('30-71234567-8')).toBe('30-71234567-8');
  expect(normalizarCuit('123')).toBeNull();
});

test('normalizarFactura limpia lo que devuelve el modelo', () => {
  const f = normalizarFactura({
    tipoDocumento: 'factura', letra: 'b', emisor: '  Dental   Sur SRL ', cuit: '30-71234567-8',
    numero: '0003-00001234', fechaEmision: '2026-09-01', fechaVencimiento: '15/10/2026',
    total: '45.300,50', moneda: 'ARS', metodoPago: 'Tarjeta', pagado: 'no',
    categoria: 'INSUMOS', rubro: 'insumos odontológicos',
    items: [{ descripcion: 'Guantes', cantidad: '2', precioUnitario: '1.000', subtotal: '2.000' }, { descripcion: '' }],
  });
  expect(f).toMatchObject({
    letra: 'B', emisor: 'Dental Sur SRL', cuit: '30-71234567-8', fechaEmision: '01/09/2026',
    fechaVencimiento: '15/10/2026', total: 45300.5, moneda: 'Pesos', metodoPago: 'tarjeta',
    pagado: null, categoria: 'insumos', descripcion: 'Dental Sur SRL',
  });
  expect(f.items).toEqual([{ descripcion: 'Guantes', cantidad: 2, precioUnitario: 1000, subtotal: 2000 }]);
});

test('categoría desconocida cae en otro_egreso; dólares se detectan', () => {
  const f = normalizarFactura({ categoria: 'viajes', moneda: 'USD', total: 10 });
  expect(f.categoria).toBe('otro_egreso');
  expect(f.moneda).toBe('Dólares');
});

test('normalizarClasificacion acota tipo y confianza', () => {
  expect(normalizarClasificacion({ tipo: 'Factura', confianza: 3 })).toEqual({ tipo: 'factura', confianza: 1 });
  expect(normalizarClasificacion({ tipo: 'foto de perro' })).toEqual({ tipo: 'otro', confianza: 0 });
});

test('sin GEMINI_API_KEY no llama a nada', async () => {
  expect(await clasificarDocumento(Buffer.from('x'))).toEqual({ error: 'vision_no_configurada' });
});

describe('buscarDuplicadoEn', () => {
  const existentes = [
    { id: 'c1', hash: 'h1', cuit: '30-71234567-8', emisor: 'Dental Sur', numero: '0003-00001234', total: 45300.5, fechaCarga: '01/09/2026 10:00' },
    { id: 'c2', hash: 'h2', cuit: '', emisor: 'Farmacia Pepe', numero: '', total: 1200 },
  ];

  test('mismo archivo', () => {
    expect(buscarDuplicadoEn(existentes, { hash: 'h1' })).toMatchObject({ motivo: 'mismo_archivo', comprobante: { id: 'c1' } });
  });

  test('mismo CUIT + número (con o sin ceros/guiones) + total', () => {
    const d = buscarDuplicadoEn(existentes, { hash: 'otro', cuit: '30712345678', numero: '3-1234', total: 45300.5 });
    expect(d).toMatchObject({ motivo: 'mismos_datos', comprobante: { id: 'c1' } });
  });

  test('distinto total no es duplicado', () => {
    expect(buscarDuplicadoEn(existentes, { cuit: '30712345678', numero: '0003-00001234', total: 100 })).toBeNull();
  });

  test('sin número no compara por datos (dos tickets iguales pueden ser compras distintas)', () => {
    expect(buscarDuplicadoEn(existentes, { emisor: 'Farmacia Pepe', numero: null, total: 1200 })).toBeNull();
  });
});

describe('decidirEstado', () => {
  const hoy = new Date(2026, 8, 30, 10, 0);
  test('pagado explícito manda', () => {
    expect(decidirEstado({ pagado: true, fechaVencimiento: '15/10/2026' }, hoy)).toBe('Cobrado');
    expect(decidirEstado({ pagado: false }, hoy)).toBe('Pendiente');
  });
  test('vencimiento hoy o futuro -> Pendiente; pasado -> Cobrado', () => {
    expect(decidirEstado({ pagado: null, fechaVencimiento: '30/09/2026' }, hoy)).toBe('Pendiente');
    expect(decidirEstado({ pagado: null, fechaVencimiento: '15/10/2026' }, hoy)).toBe('Pendiente');
    expect(decidirEstado({ pagado: null, fechaVencimiento: '01/09/2026' }, hoy)).toBe('Cobrado');
  });
  test('sin datos -> Cobrado (ticket de compra)', () => {
    expect(decidirEstado({ pagado: null, fechaVencimiento: null }, hoy)).toBe('Cobrado');
  });
});

test('facturaAEntities arma un gasto con el vínculo al comprobante', () => {
  const factura = normalizarFactura({
    emisor: 'Edenor', rubro: 'electricidad', categoria: 'servicios', total: 35000,
    fechaEmision: '01/09/2026', pagado: false, fechaVencimiento: '20/10/2026',
  });
  const e = facturaAEntities(factura, { idComprobante: 'comp_1' });
  expect(e).toMatchObject({
    tipo: 'gasto', monto: 35000, estado: 'Pendiente', categoria: 'servicios',
    proveedorNombre: 'Edenor', fechaVencimiento: '20/10/2026', referenciaId: 'comp:comp_1',
    comprobante: { id: 'comp_1', tipo: 'factura', emisor: 'Edenor' },
  });
  expect(textoParaAmbito(factura)).toContain('electricidad');
});
