const svc = require('../src/services/login-telegram.service');

beforeEach(() => {
  svc._reiniciar();
  jest.useRealTimers();
});

describe('crearSolicitud', () => {
  test('devuelve un id público de 22 caracteres (cabe en el payload de /start) y un secret aparte', () => {
    const s = svc.crearSolicitud({ ip: '1.2.3.4', userAgent: 'x' });
    expect(s.id).toMatch(svc.ID_REGEX);
    expect(`login_${s.id}`.length).toBeLessThanOrEqual(64);
    expect(s.secret).toHaveLength(43);
    expect(s.secret).not.toBe(s.id);
    expect(s.expiraEnSeg).toBe(300);
  });

  test('cada solicitud es distinta', () => {
    const a = svc.crearSolicitud();
    const b = svc.crearSolicitud();
    expect(a.id).not.toBe(b.id);
    expect(a.secret).not.toBe(b.secret);
  });

  test('tope de solicitudes pendientes (anti-abuso)', () => {
    for (let i = 0; i < svc.MAX_PENDIENTES; i++) svc.crearSolicitud();
    expect(() => svc.crearSolicitud()).toThrow('demasiadas_solicitudes');
  });

  test('las vencidas se purgan y liberan lugar', () => {
    jest.useFakeTimers();
    for (let i = 0; i < svc.MAX_PENDIENTES; i++) svc.crearSolicitud();
    jest.setSystemTime(Date.now() + svc.TTL_MS + 1000);
    expect(() => svc.crearSolicitud()).not.toThrow();
    expect(svc._cantidad()).toBe(1);
  });
});

describe('flujo completo', () => {
  test('pendiente → aprobada → se entrega UNA sola vez', () => {
    const { id, secret } = svc.crearSolicitud();
    expect(svc.consultar(id, secret)).toEqual({ estado: 'pendiente' });
    expect(svc.aprobar(id, 4444)).toBe(true);
    expect(svc.consultar(id, secret)).toEqual({ estado: 'aprobada', userId: '4444' });
    // segunda consulta: ya no existe
    expect(svc.consultar(id, secret)).toEqual({ estado: 'vencida' });
  });

  test('rechazada: se informa una vez y desaparece', () => {
    const { id, secret } = svc.crearSolicitud();
    expect(svc.rechazar(id)).toBe(true);
    expect(svc.consultar(id, secret)).toEqual({ estado: 'rechazada' });
    expect(svc.consultar(id, secret)).toEqual({ estado: 'vencida' });
  });

  test('aprobar es idempotente y atómico: no se puede aprobar dos veces ni cambiar de identidad', () => {
    const { id, secret } = svc.crearSolicitud();
    expect(svc.aprobar(id, 1111)).toBe(true);
    expect(svc.aprobar(id, 2222)).toBe(false);   // otra persona no pisa la aprobación
    expect(svc.rechazar(id)).toBe(false);          // ni se puede rechazar lo ya aprobado
    expect(svc.consultar(id, secret)).toEqual({ estado: 'aprobada', userId: '1111' });
  });

  test('una solicitud rechazada no se puede aprobar después', () => {
    const { id } = svc.crearSolicitud();
    svc.rechazar(id);
    expect(svc.aprobar(id, 1111)).toBe(false);
  });
});

describe('seguridad', () => {
  test('con el id solo (sin el secret) NO se obtiene la sesión', () => {
    const { id } = svc.crearSolicitud();
    svc.aprobar(id, 1111);
    expect(svc.consultar(id, 'secret-falso')).toEqual({ estado: 'vencida' });
    expect(svc.consultar(id, '')).toEqual({ estado: 'vencida' });
    expect(svc.consultar(id, undefined)).toEqual({ estado: 'vencida' });
  });

  test('un intento con secret incorrecto no consume ni arruina la solicitud real', () => {
    const { id, secret } = svc.crearSolicitud();
    svc.aprobar(id, 1111);
    svc.consultar(id, 'incorrecto');
    expect(svc.consultar(id, secret)).toEqual({ estado: 'aprobada', userId: '1111' });
  });

  test('un id inexistente o malformado se ve igual que una vencida (no filtra nada)', () => {
    expect(svc.consultar('a'.repeat(22), 'x')).toEqual({ estado: 'vencida' });
    expect(svc.consultar('../etc/passwd', 'x')).toEqual({ estado: 'vencida' });
    expect(svc.consultar(null, null)).toEqual({ estado: 'vencida' });
    expect(svc.aprobar('malo', 1)).toBe(false);
    expect(svc.obtenerParaAprobar('malo')).toBeNull();
  });

  test('vencida a los 5 minutos: no se puede aprobar ni consultar', () => {
    jest.useFakeTimers();
    const { id, secret } = svc.crearSolicitud();
    jest.setSystemTime(Date.now() + svc.TTL_MS - 1000);
    expect(svc.consultar(id, secret)).toEqual({ estado: 'pendiente' });
    jest.setSystemTime(Date.now() + 2000);
    expect(svc.aprobar(id, 1111)).toBe(false);
    expect(svc.consultar(id, secret)).toEqual({ estado: 'vencida' });
  });

  test('no guarda el secret en claro: solo su hash', () => {
    const { id, secret } = svc.crearSolicitud();
    const guardado = JSON.stringify(svc._volcar());
    expect(guardado).not.toContain(secret);
    const { secretHash } = svc._volcar().find((x) => x.id === id);
    expect(secretHash).toMatch(/^[0-9a-f]{64}$/); // sha256
  });
});

describe('obtenerParaAprobar (lo que se muestra en el bot)', () => {
  test('muestra IP, navegador y hora de quien pidió el ingreso', () => {
    const { id } = svc.crearSolicitud({
      ip: '190.1.2.3',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
    });
    const r = svc.obtenerParaAprobar(id);
    expect(r).toMatchObject({ id, ip: '190.1.2.3', navegador: 'Chrome en Windows' });
    expect(typeof r.creadaEn).toBe('number');
  });

  test('null si ya se resolvió o no existe', () => {
    const { id } = svc.crearSolicitud();
    svc.aprobar(id, 1);
    expect(svc.obtenerParaAprobar(id)).toBeNull();
    expect(svc.obtenerParaAprobar('b'.repeat(22))).toBeNull();
  });
});

describe('resumirUserAgent', () => {
  test.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Chrome en Windows'],
    ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0', 'Edge en Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'Safari en iPhone'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'Safari en iPad'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36', 'Chrome en Android'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/121.0', 'Firefox en Mac'],
    ['', 'Navegador desconocido'],
    [undefined, 'Navegador desconocido'],
    ['curl/8.0', 'Navegador desconocido'],
  ])('%s', (ua, esperado) => {
    expect(svc.resumirUserAgent(ua)).toBe(esperado);
  });
});
