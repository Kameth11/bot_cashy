// Si Telegram rechaza el aviso de llegada: bloquear el bot o no haberlo iniciado es esperable (warn, sin alerta);
// cualquier otra cosa se clasifica con logFallo y deja el código/descripción de Telegram en el log.

jest.mock('../src/lib/supabase', () => ({ isAvailable: jest.fn(() => true) }));
jest.mock('../src/lib/tenant-db', () => ({
  forTenant: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({ data: [{ telegram_user_id: '9999', nombre: 'Diego' }] }),
      })),
    })),
  })),
}));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockSendMessage = jest.fn();
jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: (...a) => mockSendMessage(...a) } } }));

const logger = require('../src/lib/logger');
const { notificarLlegadaPaciente } = require('../src/services/profesional.service');

const errTelegram = (error_code, description) => Object.assign(new Error(`${error_code}: ${description}`), { response: { error_code, description } });

beforeEach(() => jest.clearAllMocks());

test('403 (bloqueó el bot) → warn, sin error ni alerta', async () => {
  mockSendMessage.mockRejectedValue(errTelegram(403, 'Forbidden: bot was blocked by the user'));
  const r = await notificarLlegadaPaciente('t1', 'Diego', 'Juan', '10:00', 'Control');
  expect(r).toEqual({ ok: false, error: 'telegram_inaccesible', profesional: 'Diego' });
  expect(logger.warn).toHaveBeenCalledWith('Profesional', expect.stringContaining('bloqueó el bot'), expect.objectContaining({ codigo: 403 }));
  expect(logger.error).not.toHaveBeenCalled();
});

test('400 "chat not found" (nunca inició el bot) → warn', async () => {
  mockSendMessage.mockRejectedValue(errTelegram(400, 'Bad Request: chat not found'));
  const r = await notificarLlegadaPaciente('t1', 'Diego', 'Juan', '10:00', 'Control');
  expect(r.error).toBe('telegram_inaccesible');
  expect(logger.error).not.toHaveBeenCalled();
});

test('400 por formato (no es chat inexistente) → no se confunde con el caso anterior y deja la descripción en el log', async () => {
  mockSendMessage.mockRejectedValue(errTelegram(400, "Bad Request: can't parse entities"));
  const r = await notificarLlegadaPaciente('t1', 'Diego', 'Juan', '10:00', 'Control');
  expect(r.error).toBe('envio_fallido');
  expect(logger.warn).toHaveBeenCalledWith('Profesional', 'Error enviando aviso de llegada', expect.objectContaining({ codigo: 400, descripcion: expect.stringContaining('parse entities') }));
});

test('un error de código (TypeError) sí sube a error', async () => {
  mockSendMessage.mockRejectedValue(new TypeError('x is not a function'));
  const r = await notificarLlegadaPaciente('t1', 'Diego', 'Juan', '10:00', 'Control');
  expect(r.error).toBe('envio_fallido');
  expect(logger.error).toHaveBeenCalledWith('Profesional', 'Error enviando aviso de llegada', expect.objectContaining({ err: 'x is not a function' }));
});
