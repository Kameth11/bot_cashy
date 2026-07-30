const {
  resolverAmbito,
  inferirCategoriaPersonal,
  normalizarCategoriaPersonal,
  detectarTerminoAmbiguo,
  ALL_CATEGORIAS_PERSONAL,
} = require('../src/services/personal-nlp.service');

describe('resolverAmbito — marcadores fuertes', () => {
  test.each([
    ['nafta 20000'],
    ['cargué gasoil 35000'],
    ['coto 45000'],
    ['pedidosya 18000'],
    ['netflix 5000'],
    ['colegio de los chicos 90000'],
    ['pasajes a brasil 800000'],
  ])('detecta "%s" como personal', (texto) => {
    expect(resolverAmbito(texto)).toMatchObject({
      ambito: 'personal',
      ambiguo: false,
      razon: 'marcador_personal',
    });
  });

  test.each([
    ['consulta Juan Perez 15000 efectivo'],
    ['implante Dra Lopez 90000'],
    ['servicio endodoncia 50000'],
    ['anticipo Marta ortodoncia 50000'],
  ])('detecta "%s" como consultorio', (texto) => {
    expect(resolverAmbito(texto)).toMatchObject({
      ambito: 'consultorio',
      ambiguo: false,
    });
  });
});

describe('resolverAmbito — calificadores explícitos (capa 1)', () => {
  test('"luz de casa" es personal', () => {
    expect(resolverAmbito('pagué la luz de casa 80000')).toMatchObject({
      ambito: 'personal',
      razon: 'calificador',
    });
  });

  test('"luz del consultorio" es consultorio', () => {
    expect(resolverAmbito('pagué la luz del consultorio 80000')).toMatchObject({
      ambito: 'consultorio',
      razon: 'calificador',
    });
  });

  test('el calificador de consultorio gana sobre un marcador personal', () => {
    // Una cochera alquilada para el consultorio no es un gasto personal.
    expect(resolverAmbito('cochera del consultorio 50000')).toMatchObject({
      ambito: 'consultorio',
      razon: 'calificador',
    });
  });

  test('"alquiler del depto" es personal', () => {
    expect(resolverAmbito('alquiler del depto 500000')).toMatchObject({
      ambito: 'personal',
      razon: 'calificador',
    });
  });
});

describe('resolverAmbito — memoria de preferencias (capa 2)', () => {
  test('sin preferencia, un término ambiguo cae en consultorio y queda marcado', () => {
    expect(resolverAmbito('alquiler 500000')).toMatchObject({
      ambito: 'consultorio',
      ambiguo: true,
      termino: 'alquiler',
      razon: 'fallback_ambiguo',
    });
  });

  test('con preferencia guardada, respeta la corrección previa del usuario', () => {
    expect(resolverAmbito('alquiler 500000', { preferencias: { alquiler: 'personal' } })).toMatchObject({
      ambito: 'personal',
      ambiguo: false,
      razon: 'preferencia',
    });
  });

  test('acepta la preferencia como Map además de objeto plano', () => {
    const preferencias = new Map([['expensas', 'personal']]);
    expect(resolverAmbito('expensas 120000', { preferencias })).toMatchObject({
      ambito: 'personal',
      razon: 'preferencia',
    });
  });

  test('una preferencia inválida no se aplica y cae al fallback', () => {
    expect(resolverAmbito('alquiler 500000', { preferencias: { alquiler: 'basura' } })).toMatchObject({
      ambito: 'consultorio',
      razon: 'fallback_ambiguo',
    });
  });
});

describe('resolverAmbito — no-regresión del ámbito consultorio', () => {
  // Estos casos ya funcionaban antes de agregar finanzas personales y deben
  // seguir resolviéndose igual: son la carga habitual del cliente real.
  test.each([
    ['sueldo asistente 200k'],
    ['guantes 12000'],
    ['monotributo enero 45000'],
    ['expensas 120000'],
    ['luz 80000'],
    ['seguro 45000'],
    ['mantenimiento autoclave 60000'],
  ])('"%s" sigue cayendo en consultorio', (texto) => {
    expect(resolverAmbito(texto).ambito).toBe('consultorio');
  });

  test('"sueldo" suelto no se lee como sueldo personal', () => {
    // `sueldo` es ambiguo: en el consultorio es un egreso (pagar al empleado).
    // Solo un calificador o una preferencia lo mueven a personal.
    expect(resolverAmbito('sueldo 1200000').ambito).toBe('consultorio');
    expect(resolverAmbito('mi sueldo 1200000').ambito).toBe('personal');
  });

  test('"salario" sí es un marcador personal inequívoco', () => {
    expect(resolverAmbito('salario 1200000')).toMatchObject({
      ambito: 'personal',
      razon: 'marcador_personal',
    });
  });
});

describe('inferirCategoriaPersonal', () => {
  test.each([
    ['nafta 20000', 'transporte'],
    ['coto 45000', 'supermercado'],
    ['pedidosya 18000', 'comida_afuera'],
    ['netflix 5000', 'entretenimiento'],
    ['colegio 90000', 'educacion'],
    ['veterinario 30000', 'mascotas'],
    ['zapatillas 120000', 'ropa'],
    ['notebook 900000', 'tecnologia'],
    ['hotel en brasil 400000', 'viajes'],
    ['prepaga osde 250000', 'salud'],
    ['seguro del auto 90000', 'auto'],
  ])('categoriza "%s" como %s', (texto, esperada) => {
    expect(inferirCategoriaPersonal('gasto', texto)).toBe(esperada);
  });

  test.each([
    ['alquiler del depto 500000', 'alquiler'],
    ['expensas 120000', 'expensas'],
    ['luz de casa 80000', 'servicios'],
    ['internet 40000', 'servicios'],
    ['abl 25000', 'impuestos'],
    ['farmacia 15000', 'farmacia'],
  ])('categoriza el ambiguo "%s" como %s cuando ya es personal', (texto, esperada) => {
    expect(inferirCategoriaPersonal('gasto', texto)).toBe(esperada);
  });

  test('cae en "otros" cuando no reconoce el gasto', () => {
    expect(inferirCategoriaPersonal('gasto', 'algo rarísimo 1000')).toBe('otros');
  });

  test('categoriza ingresos personales', () => {
    expect(inferirCategoriaPersonal('ingreso', 'mi sueldo 1200000')).toBe('sueldo');
    expect(inferirCategoriaPersonal('ingreso', 'alquiler del depto cobrado 300000')).toBe('alquiler_cobrado');
    expect(inferirCategoriaPersonal('ingreso', 'changa de fin de semana 50000')).toBe('freelance');
    expect(inferirCategoriaPersonal('ingreso', 'no sé qué es 1000')).toBe('otro_ingreso');
  });

  test('toda categoría inferida pertenece al set cerrado', () => {
    const textos = ['nafta', 'coto', 'netflix', 'algo raro', 'luz de casa', 'abl'];
    for (const t of textos) {
      expect(ALL_CATEGORIAS_PERSONAL.has(inferirCategoriaPersonal('gasto', t))).toBe(true);
    }
  });
});

describe('normalizarCategoriaPersonal', () => {
  test('normaliza acentos y espacios', () => {
    expect(normalizarCategoriaPersonal('Comida Afuera')).toBe('comida_afuera');
    expect(normalizarCategoriaPersonal('EDUCACIÓN')).toBe('educacion');
  });

  test('rechaza categorías fuera del set cerrado', () => {
    expect(normalizarCategoriaPersonal('insumos')).toBeNull();
    expect(normalizarCategoriaPersonal('cualquier cosa')).toBeNull();
    expect(normalizarCategoriaPersonal(null)).toBeNull();
  });
});

describe('detectarTerminoAmbiguo', () => {
  test('encuentra el término ambiguo presente', () => {
    expect(detectarTerminoAmbiguo('pagué el alquiler 500000')).toBe('alquiler');
    expect(detectarTerminoAmbiguo('la luz vino carísima')).toBe('luz');
  });

  test('devuelve null cuando no hay ambigüedad', () => {
    expect(detectarTerminoAmbiguo('nafta 20000')).toBeNull();
    expect(detectarTerminoAmbiguo('consulta Juan')).toBeNull();
  });
});
