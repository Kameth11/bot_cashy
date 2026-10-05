const svc = require('../src/services/login-google.service');

const CLIENT = 'cliente.apps.googleusercontent.com';
afterEach(() => { svc._setVerificador(null); delete process.env.GOOGLE_CLIENT_ID; });

test('sin GOOGLE_CLIENT_ID no está configurado y no verifica nada', async () => {
  expect(svc.configurado()).toBe(false);
  await expect(svc.verificarCredencial('x')).rejects.toThrow('google_no_configurado');
});

describe('con Client ID', () => {
  beforeEach(() => { process.env.GOOGLE_CLIENT_ID = CLIENT; });

  test('devuelve sub, email normalizado y nombre; la audiencia es nuestro Client ID', async () => {
    const verificador = jest.fn().mockResolvedValue({ sub: '123', email: 'Ana@Gmail.com', email_verified: true, name: 'Ana' });
    svc._setVerificador(verificador);
    expect(await svc.verificarCredencial('tok')).toEqual({ sub: '123', email: 'ana@gmail.com', nombre: 'Ana' });
    expect(verificador).toHaveBeenCalledWith('tok', CLIENT);
  });

  test.each([
    ['no es string', 123],
    ['vacía', ''],
    ['demasiado larga', 'x'.repeat(svc.MAX_CREDENCIAL + 1)],
  ])('rechaza una credencial %s sin consultar a Google', async (_n, cred) => {
    const verificador = jest.fn();
    svc._setVerificador(verificador);
    await expect(svc.verificarCredencial(cred)).rejects.toThrow('google_credencial_invalida');
    expect(verificador).not.toHaveBeenCalled();
  });

  test('un token que Google no valida (firma, audiencia, vencido) es inválido', async () => {
    svc._setVerificador(async () => { throw new Error('Wrong recipient'); });
    await expect(svc.verificarCredencial('tok')).rejects.toThrow('google_credencial_invalida');
  });

  test('sin sub, o con email sin verificar, no sirve', async () => {
    svc._setVerificador(async () => ({ email: 'a@b.com', email_verified: true }));
    await expect(svc.verificarCredencial('tok')).rejects.toThrow('google_credencial_invalida');
    svc._setVerificador(async () => ({ sub: '1', email: 'a@b.com', email_verified: false }));
    await expect(svc.verificarCredencial('tok')).rejects.toThrow('google_email_no_verificado');
  });
});
