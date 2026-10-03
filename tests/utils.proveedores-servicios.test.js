const { esProveedorDeServicios, ejemplosParaPrompt } = require('../src/utils/proveedores-servicios');
const { normalizarFactura } = require('../src/services/comprobante-vision.service');

describe('esProveedorDeServicios', () => {
  test.each([
    'EDENOR S.A.', 'Edesur', 'Movistar', 'Telefónica de Argentina', 'Personal', 'Telecom Argentina',
    'CLARO (AMX Argentina)', 'Naturgy BAN', 'Metrogas', 'AySA', 'YPF S.A.', 'Shell C.A.P.S.A.',
    'Axion Energy', 'Telecentro', 'Fibertel', 'DirecTV', 'Camuzzi Gas Pampeana', 'EPEC',
  ])('%s es proveedor de servicios', (emisor) => {
    expect(esProveedorDeServicios({ emisor })).toBe(true);
  });

  test('ignora tildes y mayúsculas', () => {
    expect(esProveedorDeServicios({ emisor: 'cooperativa electrica de Rafaela' })).toBe(true);
    expect(esProveedorDeServicios({ emisor: 'TELEFONICA' })).toBe(true);
  });

  test('no confunde comercios ni nombres que solo contienen la sigla', () => {
    expect(esProveedorDeServicios({ emisor: 'Dental Sur SRL' })).toBe(false);
    expect(esProveedorDeServicios({ emisor: 'Supermercado Disco' })).toBe(false);
    expect(esProveedorDeServicios({ emisor: 'Pepe Epecista' })).toBe(false);
    expect(esProveedorDeServicios({ emisor: 'Juan Perez' })).toBe(false);
    expect(esProveedorDeServicios({})).toBe(false);
  });

  test('por rubro genérico cuando el emisor no está en el catálogo', () => {
    expect(esProveedorDeServicios({ emisor: 'Cooperativa X', rubro: 'Electricidad' })).toBe(true);
    expect(esProveedorDeServicios({ emisor: 'Algo SA', rubro: 'telefonía' })).toBe(true);
    expect(esProveedorDeServicios({ emisor: 'Algo SA', rubro: 'combustible' })).toBe(true);
    expect(esProveedorDeServicios({ emisor: 'Algo SA', rubro: 'insumos odontológicos' })).toBe(false);
  });

  test('la lista para prompts incluye los ejemplos pedidos', () => {
    const lista = ejemplosParaPrompt();
    for (const n of ['Edenor', 'Edesur', 'Movistar', 'Personal', 'Claro', 'Naturgy', 'YPF', 'Shell']) {
      expect(lista).toContain(n);
    }
  });
});

describe('normalizarFactura con proveedores de servicios', () => {
  test('fuerza categoria servicios aunque el modelo diga otra cosa', () => {
    const f = normalizarFactura({ emisor: 'EDENOR S.A.', categoria: 'otro_egreso', total: 1000, tipoDocumento: 'otro' });
    expect(f.categoria).toBe('servicios');
    expect(f.tipoDocumento).toBe('boleta_servicio');
  });

  test('YPF (nafta) también es servicios', () => {
    expect(normalizarFactura({ emisor: 'YPF', rubro: 'combustible', categoria: 'mantenimiento', total: 5 }).categoria).toBe('servicios');
  });

  test('respeta el tipo de documento que ya vino del modelo', () => {
    expect(normalizarFactura({ emisor: 'Movistar', tipoDocumento: 'factura', total: 5 }).tipoDocumento).toBe('factura');
  });

  test('un emisor que no es de servicios conserva la categoría del modelo', () => {
    expect(normalizarFactura({ emisor: 'Dental Sur', categoria: 'insumos', total: 5 }).categoria).toBe('insumos');
  });
});
