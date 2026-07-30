const {
  validarTextoUsuario,
  normalizarDescripcion,
  validarMonto,
  validarCotizacion,
  validarEmail,
  validarSheetId,
} = require('../src/utils/validation');
const { MAX_MOVIMIENTO_MONTO, MAX_COTIZACION_DOLAR, MAX_TEXT_LENGTH } = require('../src/config');

describe('validarMonto', () => {
  test('acepta montos positivos y negativos', () => {
    expect(validarMonto(15000)).toEqual({ ok: true, valor: 15000 });
    expect(validarMonto(-500)).toEqual({ ok: true, valor: -500 });
  });

  test('parsea strings con punto decimal', () => {
    expect(validarMonto('1234.56')).toEqual({ ok: true, valor: 1234.56 });
  });

  test('rechaza cero, NaN y no-numéricos', () => {
    expect(validarMonto(0).ok).toBe(false);
    expect(validarMonto('').ok).toBe(false);
    expect(validarMonto('abc').ok).toBe(false);
    expect(validarMonto(NaN).ok).toBe(false);
    expect(validarMonto(Infinity).ok).toBe(false);
  });

  test('rechaza montos por encima del tope', () => {
    expect(validarMonto(MAX_MOVIMIENTO_MONTO + 1).ok).toBe(false);
    expect(validarMonto(MAX_MOVIMIENTO_MONTO).ok).toBe(true);
  });
});

describe('validarCotizacion', () => {
  test('acepta cotizaciones positivas dentro del tope', () => {
    expect(validarCotizacion(1200)).toEqual({ ok: true, valor: 1200 });
  });
  test('rechaza <= 0 y por encima del tope', () => {
    expect(validarCotizacion(0).ok).toBe(false);
    expect(validarCotizacion(-5).ok).toBe(false);
    expect(validarCotizacion(MAX_COTIZACION_DOLAR + 1).ok).toBe(false);
  });
});

describe('validarTextoUsuario', () => {
  test('acepta texto normal', () => {
    expect(validarTextoUsuario('consulta juan 5000')).toEqual({ ok: true });
  });
  test('rechaza no-string, vacío y demasiado largo', () => {
    expect(validarTextoUsuario(123).ok).toBe(false);
    expect(validarTextoUsuario(null).ok).toBe(false);
    expect(validarTextoUsuario('').ok).toBe(false);
    expect(validarTextoUsuario('x'.repeat(MAX_TEXT_LENGTH + 1)).ok).toBe(false);
  });
});

describe('normalizarDescripcion', () => {
  test('sanitiza y acepta descripción válida', () => {
    const r = normalizarDescripcion('  Consulta   Juan  ');
    expect(r.ok).toBe(true);
    expect(r.valor).toBe('Consulta Juan');
  });
  test('rechaza descripción de menos de 2 caracteres', () => {
    expect(normalizarDescripcion('a').ok).toBe(false);
    expect(normalizarDescripcion('   ').ok).toBe(false);
  });
});

describe('validarEmail', () => {
  test('normaliza a minúsculas y trim', () => {
    expect(validarEmail('  Juan@Clinica.COM ')).toEqual({ ok: true, valor: 'juan@clinica.com' });
  });
  test('rechaza emails inválidos', () => {
    expect(validarEmail('sinarroba').ok).toBe(false);
    expect(validarEmail('a@b').ok).toBe(false);
    expect(validarEmail(null).ok).toBe(false);
  });
});

describe('validarSheetId', () => {
  test('acepta IDs con el formato de Google Sheets', () => {
    expect(validarSheetId('1AbC_def-GHI23456789xyz').ok).toBe(true);
  });
  test('rechaza IDs muy cortos o con caracteres inválidos', () => {
    expect(validarSheetId('corto').ok).toBe(false);
    expect(validarSheetId('tiene espacios y simbolos !!').ok).toBe(false);
  });
});
