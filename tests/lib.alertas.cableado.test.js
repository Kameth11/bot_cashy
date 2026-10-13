// Cableado real: iniciarAlertas() + logger.error → webhook de Discord (axios.post).

const mockAxiosPost = jest.fn();
jest.mock('axios', () => ({ post: (...a) => mockAxiosPost(...a) }));
// Si algo intentara avisar por Telegram, esto lo delata.
const mockSendMessage = jest.fn();
jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: (...a) => mockSendMessage(...a) } } }));
jest.mock('../src/config', () => ({ AUTHORIZED_USER_ID: 4242 }));

const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/AbC-dEf_123';

let logger, alertas;
beforeEach(() => {
  jest.resetModules();
  mockAxiosPost.mockReset().mockResolvedValue({});
  mockSendMessage.mockReset().mockResolvedValue({});
  delete process.env.ALERTAS_ERRORES;
  delete process.env.ALERTAS_CHAT_ID;
  process.env.ALERTAS_DISCORD_WEBHOOK_URL = WEBHOOK;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  logger = require('../src/lib/logger');
  alertas = require('../src/lib/alertas');
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.ALERTAS_DISCORD_WEBHOOK_URL; });

test('logger.error va a Discord; warn no; y NUNCA a Telegram', () => {
  expect(alertas.iniciarAlertas()).toBe(true);
  logger.warn('NOTIF', 'transitorio', { err: 'timeout' });
  expect(mockAxiosPost).not.toHaveBeenCalled();

  logger.error('NOTIF', 'Falta la tabla X', { err: 'no existe' });
  expect(mockAxiosPost).toHaveBeenCalledTimes(1);
  const [url, cuerpo] = mockAxiosPost.mock.calls[0];
  expect(url).toBe(WEBHOOK);
  expect(cuerpo.content).toContain('[NOTIF] Falta la tabla X');
  expect(cuerpo.allowed_mentions).toEqual({ parse: [] });
  expect(mockSendMessage).not.toHaveBeenCalled();
});

test('sin webhook no hay avisos (ni por Telegram): queda un warn al arrancar', () => {
  delete process.env.ALERTAS_DISCORD_WEBHOOK_URL;
  const warn = jest.spyOn(logger, 'warn');
  expect(alertas.iniciarAlertas()).toBe(false);
  expect(warn).toHaveBeenCalledWith('ALERTAS', expect.stringContaining('Sin ALERTAS_DISCORD_WEBHOOK_URL'));

  logger.error('S', 'm', {});
  expect(mockAxiosPost).not.toHaveBeenCalled();
  expect(mockSendMessage).not.toHaveBeenCalled();
});

test('una URL que no es de Discord se rechaza: no se le manda nada ni se cae a Telegram', () => {
  process.env.ALERTAS_DISCORD_WEBHOOK_URL = 'https://evil.example.com/api/webhooks/1/abc';
  const warn = jest.spyOn(logger, 'warn');
  expect(alertas.iniciarAlertas()).toBe(false);
  logger.error('S', 'm', {});
  expect(mockAxiosPost).not.toHaveBeenCalled();
  expect(mockSendMessage).not.toHaveBeenCalled();
  expect(JSON.stringify(warn.mock.calls)).not.toContain('evil.example.com');
});

test('ALERTAS_ERRORES=off lo apaga', () => {
  process.env.ALERTAS_ERRORES = 'off';
  expect(alertas.iniciarAlertas()).toBe(false);
  logger.error('S', 'm', {});
  expect(mockAxiosPost).not.toHaveBeenCalled();
});

test('si Discord falla se loguea como warn SIN la URL del webhook, y no hay bucle', async () => {
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

test('iniciarAlertas es idempotente (no duplica avisos)', () => {
  alertas.iniciarAlertas();
  alertas.iniciarAlertas();
  logger.error('S', 'm', {});
  expect(mockAxiosPost).toHaveBeenCalledTimes(1);
});

test('un mensaje con @everyone no menciona a nadie y se recorta a 1900 caracteres', () => {
  const post = jest.fn().mockResolvedValue({});
  alertas.crearEnvioDiscord(WEBHOOK, post)('@everyone ' + 'x'.repeat(3000));
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
