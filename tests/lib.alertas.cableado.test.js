// Cableado real: iniciarAlertas() + logger.error → bot.telegram.sendMessage.

jest.mock('../src/config', () => ({ AUTHORIZED_USER_ID: 4242 }));
const mockSendMessage = jest.fn();
const mockAxiosPost = jest.fn();
jest.mock('axios', () => ({ post: (...a) => mockAxiosPost(...a) }));
jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: (...a) => mockSendMessage(...a) } } }));

let logger, alertas;
beforeEach(() => {
  jest.resetModules();
  mockSendMessage.mockReset().mockResolvedValue({});
  mockAxiosPost.mockReset().mockResolvedValue({});
  delete process.env.ALERTAS_DISCORD_WEBHOOK_URL;
  delete process.env.ALERTAS_ERRORES;
  delete process.env.ALERTAS_CHAT_ID;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  logger = require('../src/lib/logger');
  alertas = require('../src/lib/alertas');
});
afterEach(() => jest.restoreAllMocks());

test('logger.error le llega al admin por Telegram; warn no', () => {
  expect(alertas.iniciarAlertas()).toBe(true);
  logger.warn('NOTIF', 'transitorio', { err: 'timeout' });
  expect(mockSendMessage).not.toHaveBeenCalled();

  logger.error('NOTIF', 'Falta la tabla X', { err: 'no existe' });
  expect(mockSendMessage).toHaveBeenCalledTimes(1);
  expect(mockSendMessage).toHaveBeenCalledWith(4242, expect.stringContaining('[NOTIF] Falta la tabla X'));
});

test('ALERTAS_CHAT_ID tiene prioridad sobre el admin', () => {
  process.env.ALERTAS_CHAT_ID = '-100999';
  alertas.iniciarAlertas();
  logger.error('S', 'm', {});
  expect(mockSendMessage).toHaveBeenCalledWith('-100999', expect.any(String));
});

test('ALERTAS_ERRORES=off lo apaga', () => {
  process.env.ALERTAS_ERRORES = 'off';
  expect(alertas.iniciarAlertas()).toBe(false);
  logger.error('S', 'm', {});
  expect(mockSendMessage).not.toHaveBeenCalled();
});

test('si Telegram falla, no hay bucle: el fallo se loguea como warn y no dispara otro aviso', async () => {
  mockSendMessage.mockRejectedValue(new Error('403 bot bloqueado'));
  alertas.iniciarAlertas();
  logger.error('S', 'm', {});
  await new Promise(r => setImmediate(r));
  expect(mockSendMessage).toHaveBeenCalledTimes(1);
});

test('iniciarAlertas es idempotente (no duplica avisos)', () => {
  alertas.iniciarAlertas();
  alertas.iniciarAlertas();
  logger.error('S', 'm', {});
  expect(mockSendMessage).toHaveBeenCalledTimes(1);
});

const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/AbC-dEf_123';

describe('destino Discord', () => {
  test('con ALERTAS_DISCORD_WEBHOOK_URL los avisos van a Discord y NO a Telegram', () => {
    process.env.ALERTAS_DISCORD_WEBHOOK_URL = WEBHOOK;
    expect(alertas.iniciarAlertas()).toBe(true);
    logger.error('NOTIF', 'Falta la tabla X', { err: 'no existe' });

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    const [url, cuerpo] = mockAxiosPost.mock.calls[0];
    expect(url).toBe(WEBHOOK);
    expect(cuerpo.content).toContain('[NOTIF] Falta la tabla X');
    expect(cuerpo.allowed_mentions).toEqual({ parse: [] });
  });

  test('una URL que no es de Discord se rechaza: cae a Telegram y nunca se le manda nada', () => {
    process.env.ALERTAS_DISCORD_WEBHOOK_URL = 'https://evil.example.com/api/webhooks/1/abc';
    alertas.iniciarAlertas();
    logger.error('S', 'm', {});
    expect(mockAxiosPost).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  test('si Discord falla se loguea como warn SIN la URL del webhook, y no hay bucle', async () => {
    process.env.ALERTAS_DISCORD_WEBHOOK_URL = WEBHOOK;
    const err = Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 }, config: { url: WEBHOOK } });
    mockAxiosPost.mockRejectedValue(err);
    alertas.iniciarAlertas();
    const spy = jest.spyOn(logger, 'warn');
    logger.error('S', 'm', {});
    await new Promise(r => setImmediate(r));

    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('ALERTAS', expect.stringContaining('Discord'), { err: 'HTTP 404' });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('AbC-dEf_123');
  });

  test('un mensaje con @everyone no menciona a nadie y se recorta a 1900 caracteres', () => {
    const { crearEnvioDiscord } = alertas;
    const post = jest.fn().mockResolvedValue({});
    crearEnvioDiscord(WEBHOOK, post)('@everyone ' + 'x'.repeat(3000));
    const cuerpo = post.mock.calls[0][1];
    expect(cuerpo.allowed_mentions).toEqual({ parse: [] });
    expect(cuerpo.content.length).toBe(1900);
  });

  test('esWebhookDiscord acepta discord.com / discordapp.com / ptb / canary y rechaza el resto', () => {
    const { esWebhookDiscord } = alertas;
    expect(esWebhookDiscord(WEBHOOK)).toBe(true);
    expect(esWebhookDiscord('https://discordapp.com/api/webhooks/1/abc')).toBe(true);
    expect(esWebhookDiscord('https://ptb.discord.com/api/webhooks/1/abc')).toBe(true);
    expect(esWebhookDiscord('http://discord.com/api/webhooks/1/abc')).toBe(false);
    expect(esWebhookDiscord('https://discord.com.evil.com/api/webhooks/1/abc')).toBe(false);
    expect(esWebhookDiscord('https://discord.com/api/webhooks/abc/def')).toBe(false);
    expect(esWebhookDiscord('')).toBe(false);
  });
});
