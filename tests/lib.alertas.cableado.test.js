// Cableado real: iniciarAlertas() + logger.error → bot.telegram.sendMessage.

jest.mock('../src/config', () => ({ AUTHORIZED_USER_ID: 4242 }));
const mockSendMessage = jest.fn();
jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: (...a) => mockSendMessage(...a) } } }));

let logger, alertas;
beforeEach(() => {
  jest.resetModules();
  mockSendMessage.mockReset().mockResolvedValue({});
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
