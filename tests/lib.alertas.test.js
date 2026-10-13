const { crearAlertas, armarTexto, VENTANA_MISMO_ERROR_MS, MAX_AVISOS_POR_HORA } = require('../src/lib/alertas');

jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), suscribirErrores: jest.fn() }));

function armar() {
  let t = 1_000_000;
  const enviados = [];
  const alError = crearAlertas({ enviar: (txt) => enviados.push(txt), ahora: () => t });
  return { alError, enviados, avanzar: (ms) => { t += ms; } };
}

describe('alertas de errores', () => {
  test('el primer error avisa, con scope, mensaje y detalle', () => {
    const { alError, enviados } = armar();
    expect(alError('NOTIF', 'Falló algo', { err: 'boom', codigo: '42501' })).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toContain('[NOTIF] Falló algo');
    expect(enviados[0]).toContain('err: boom');
    expect(enviados[0]).toContain('código: 42501');
  });

  test('el mismo error dentro de 15 minutos no vuelve a avisar, y el siguiente cuenta las repeticiones', () => {
    const { alError, enviados, avanzar } = armar();
    alError('NOTIF', 'Falló algo', { err: 'x' });
    avanzar(60_000);
    expect(alError('NOTIF', 'Falló algo', { err: 'x' })).toBe(false);
    expect(alError('NOTIF', 'Falló algo', { err: 'x' })).toBe(false);
    expect(enviados).toHaveLength(1);

    avanzar(VENTANA_MISMO_ERROR_MS);
    expect(alError('NOTIF', 'Falló algo', { err: 'x' })).toBe(true);
    expect(enviados[1]).toContain('Se repitió 2 veces');
  });

  test('errores distintos avisan por separado', () => {
    const { alError, enviados } = armar();
    alError('NOTIF', 'uno', {});
    alError('CHAT_WEB', 'dos', {});
    alError('NOTIF', 'tres', {});
    expect(enviados).toHaveLength(3);
  });

  test('tope por hora: lo que sobra se omite y el próximo aviso lo informa', () => {
    const { alError, enviados, avanzar } = armar();
    for (let i = 0; i < MAX_AVISOS_POR_HORA; i++) alError('S', `error ${i}`, {});
    expect(enviados).toHaveLength(MAX_AVISOS_POR_HORA);

    expect(alError('S', 'otro', {})).toBe(false);
    expect(alError('S', 'otro más', {})).toBe(false);
    expect(enviados).toHaveLength(MAX_AVISOS_POR_HORA);

    avanzar(60 * 60 * 1000 + 1);
    expect(alError('S', 'después', {})).toBe(true);
    expect(enviados[enviados.length - 1]).toContain('Se omitieron 2 avisos');
  });

  test('un error omitido por el tope se reintenta cuando hay cupo (no queda silenciado 15 min más)', () => {
    const { alError, avanzar } = armar();
    for (let i = 0; i < MAX_AVISOS_POR_HORA; i++) alError('S', `e${i}`, {});
    expect(alError('S', 'tardío', {})).toBe(false);
    avanzar(60 * 60 * 1000 + 1);
    expect(alError('S', 'tardío', {})).toBe(true);
  });

  test('el scope ALERTAS se ignora (no puede generar un bucle)', () => {
    const { alError, enviados } = armar();
    expect(alError('ALERTAS', 'No se pudo enviar', {})).toBe(false);
    expect(enviados).toHaveLength(0);
  });

  test('si enviar lanza, no rompe a quien loguea', () => {
    const alError = crearAlertas({ enviar: () => { throw new Error('telegram caído'); }, ahora: () => 1 });
    expect(() => alError('S', 'm', {})).not.toThrow();
  });

  test('no filtra claves largas ni se pasa de largo', () => {
    const texto = armarTexto('S', 'm', { err: `Bearer ${'a'.repeat(60)} falló ${'x '.repeat(300)}` }, 0, 0);
    expect(texto).not.toContain('a'.repeat(32));
    expect(texto.length).toBeLessThan(700);
  });
});
