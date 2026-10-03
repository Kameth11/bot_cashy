// Contrato de salida NLP compartido entre proveedores (Gemini, OpenRouter, ...).
const { normalizarNlpResult } = require('../src/services/nlp-shared');

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

describe('normalizarNlpResult', () => {
  test('null, no-objeto o sin intent → null', () => {
    expect(normalizarNlpResult(null)).toBeNull();
    expect(normalizarNlpResult('x')).toBeNull();
    expect(normalizarNlpResult({ entities: {} })).toBeNull();
  });

  test('intents simples conservan entities (o {} si faltan)', () => {
    expect(normalizarNlpResult({ intent: 'ver_hoy' })).toEqual({ intent: 'ver_hoy', entities: {} });
    expect(normalizarNlpResult({ intent: ' ver_hoy ', entities: { a: 1 } })).toEqual({ intent: 'ver_hoy', entities: { a: 1 } });
  });

  test('no muta el objeto de entrada', () => {
    const entrada = { intent: 'registrar_movimiento', entities: { monto: '100', tipo: 'gasto' } };
    normalizarNlpResult(entrada);
    expect(entrada.entities).toEqual({ monto: '100', tipo: 'gasto' });
  });

  describe('registrar_movimiento', () => {
    const reg = (entities) => normalizarNlpResult({ intent: 'registrar_movimiento', entities });

    test('monto con coma decimal se parsea', () => {
      expect(reg({ monto: '1500,50', tipo: 'ingreso' }).entities.monto).toBe(1500.5);
    });

    test('monto negativo o cero → null (y descartado si no hay descripción)', () => {
      expect(reg({ monto: -5 })).toBeNull();
      expect(reg({ monto: 0 })).toBeNull();
      expect(reg({ monto: -5, descripcion: 'luz' }).entities.monto).toBeNull();
    });

    test('sin monto ni descripción se descarta', () => {
      expect(reg({ tipo: 'gasto' })).toBeNull();
    });

    test('tipo: sinónimos de gasto/ingreso y default ingreso', () => {
      expect(reg({ monto: 1, tipo: 'egreso' }).entities.tipo).toBe('gasto');
      expect(reg({ monto: 1, tipo: 'salio' }).entities.tipo).toBe('gasto');
      expect(reg({ monto: 1, tipo: 'entro' }).entities.tipo).toBe('ingreso');
      expect(reg({ monto: 1 }).entities.tipo).toBe('ingreso');
    });

    test('moneda: dólares/euros, default Pesos', () => {
      expect(reg({ monto: 1, moneda: 'usd' }).entities.moneda).toBe('Dólares');
      expect(reg({ monto: 1, moneda: 'eur' }).entities.moneda).toBe('Euros');
      expect(reg({ monto: 1, moneda: 'xx' }).entities.moneda).toBe('Pesos');
    });

    test('estado: solo "pendiente" es Pendiente, el resto Cobrado', () => {
      expect(reg({ monto: 1, estado: 'Pendiente' }).entities.estado).toBe('Pendiente');
      expect(reg({ monto: 1, estado: 'otra' }).entities.estado).toBe('Cobrado');
      expect(reg({ monto: 1 }).entities.estado).toBe('Cobrado');
    });

    test('categoría fuera de la lista cerrada → null; con tildes/espacios se normaliza', () => {
      expect(reg({ monto: 1, categoria: 'viajes' }).entities.categoria).toBeNull();
      expect(reg({ monto: 1, categoria: 'Saldo Final' }).entities.categoria).toBe('saldo_final');
      expect(reg({ monto: 1, categoria: 'Seña' }).entities.categoria).toBe('sena');
    });

    test('nombres de entidades: saca prefijo "de/a/con" y puntuación final', () => {
      expect(reg({ monto: 1, pacienteNombre: 'de Juan Pérez.' }).entities.pacienteNombre).toBe('Juan Pérez');
      expect(reg({ monto: 1, proveedorNombre: '  ' }).entities.proveedorNombre).toBeNull();
    });

    test('categoría consulta completa tratamiento "Consulta"', () => {
      expect(reg({ monto: 1, categoria: 'consulta' }).entities.tratamientoNombre).toBe('Consulta');
    });
  });

  test('cobrar/editar/eliminar limpian el nombre', () => {
    const r = normalizarNlpResult({ intent: 'cobrar_movimiento', entities: { nombre: 'ya me pagó Juan en efectivo' } });
    expect(r.entities.nombre).toBe('Juan');
    expect(normalizarNlpResult({ intent: 'eliminar_movimiento', entities: {} }).entities.nombre).toBeNull();
  });
});
