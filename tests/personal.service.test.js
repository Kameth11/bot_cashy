const {
  correspondeAlViaje,
  fechaStrAIso,
  CATEGORIAS_FUERA_DE_VIAJE,
} = require('../src/services/personal.service');

const viaje = {
  idViaje: 'viaje_1',
  nombre: 'Brasil',
  fechaInicio: '10/01/2026',
  fechaFin: '20/01/2026',
};

describe('fechaStrAIso', () => {
  test('convierte DD/MM/YYYY a ISO', () => {
    expect(fechaStrAIso('05/03/2026')).toBe('2026-03-05');
    expect(fechaStrAIso('5/3/2026')).toBe('2026-03-05');
  });

  test('devuelve null ante formatos que no reconoce', () => {
    expect(fechaStrAIso('2026-03-05')).toBeNull();
    expect(fechaStrAIso('')).toBeNull();
    expect(fechaStrAIso(null)).toBeNull();
  });
});

describe('correspondeAlViaje — rango de fechas', () => {
  test('atribuye un gasto dentro del rango', () => {
    expect(correspondeAlViaje(viaje, { fecha: '15/01/2026', categoria: 'comida_afuera' })).toBe(true);
  });

  test('incluye los días de inicio y fin', () => {
    expect(correspondeAlViaje(viaje, { fecha: '10/01/2026', categoria: 'transporte' })).toBe(true);
    expect(correspondeAlViaje(viaje, { fecha: '20/01/2026', categoria: 'transporte' })).toBe(true);
  });

  test('no atribuye gastos fuera del rango', () => {
    expect(correspondeAlViaje(viaje, { fecha: '09/01/2026', categoria: 'transporte' })).toBe(false);
    expect(correspondeAlViaje(viaje, { fecha: '21/01/2026', categoria: 'transporte' })).toBe(false);
  });

  test('sin viaje activo no atribuye nada', () => {
    expect(correspondeAlViaje(null, { fecha: '15/01/2026', categoria: 'transporte' })).toBe(false);
  });

  test('un viaje abierto (sin fecha de fin) atribuye desde el inicio en adelante', () => {
    const abierto = { ...viaje, fechaFin: '' };
    expect(correspondeAlViaje(abierto, { fecha: '28/02/2026', categoria: 'transporte' })).toBe(true);
    expect(correspondeAlViaje(abierto, { fecha: '01/01/2026', categoria: 'transporte' })).toBe(false);
  });

  test('una fecha ilegible no se atribuye', () => {
    expect(correspondeAlViaje(viaje, { fecha: 'ayer', categoria: 'transporte' })).toBe(false);
  });
});

describe('correspondeAlViaje — exclusión de gastos domésticos', () => {
  // El caso que motivó esta regla: pagar la luz durante el viaje no es un
  // gasto del viaje, aunque la fecha caiga justo en el rango.
  test.each([...CATEGORIAS_FUERA_DE_VIAJE])(
    'no atribuye "%s" aunque la fecha caiga dentro del viaje',
    (categoria) => {
      expect(correspondeAlViaje(viaje, { fecha: '15/01/2026', categoria })).toBe(false);
    }
  );

  test.each([
    'transporte',
    'comida_afuera',
    'entretenimiento',
    'supermercado',
    'ropa',
    'tecnologia',
    'regalos',
    'otros',
  ])('sí atribuye "%s" dentro del viaje', (categoria) => {
    expect(correspondeAlViaje(viaje, { fecha: '15/01/2026', categoria })).toBe(true);
  });

  test('la luz durante el viaje queda fuera, la cena queda dentro', () => {
    expect(correspondeAlViaje(viaje, { fecha: '15/01/2026', categoria: 'servicios' })).toBe(false);
    expect(correspondeAlViaje(viaje, { fecha: '15/01/2026', categoria: 'comida_afuera' })).toBe(true);
  });
});
