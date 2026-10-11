// Un profesional registrado desde la web (ID negativo) puede no tener Telegram: el aviso por Telegram
// no se intenta (mandarle a un ID negativo fallaría siempre) y no se reporta como un envío fallido.

jest.mock('../src/lib/supabase', () => ({ isAvailable: jest.fn(() => true) }));
let mockFilas = [];
jest.mock('../src/lib/tenant-db', () => ({
  forTenant: jest.fn(() => ({
    from: jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn(async () => ({ data: mockFilas })) })) })),
  })),
}));
jest.mock('../src/services/cliente.service', () => ({ clientes: {} }));

const mockSendMessage = jest.fn().mockResolvedValue(true);
jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: (...a) => mockSendMessage(...a) } } }));

const clienteService = require('../src/services/cliente.service');
const { notificarLlegadaPaciente } = require('../src/services/profesional.service');

beforeEach(() => {
  jest.clearAllMocks();
  clienteService.clientes = { '-100': { email: 'a@b.com' }, '-200': { email: 'c@d.com', telegramId: 555 } };
});

test('profesional de Telegram (ID positivo): se le escribe a su ID, como siempre', async () => {
  mockFilas = [{ telegram_user_id: '9999', nombre: 'Diego' }];
  const r = await notificarLlegadaPaciente('t1', 'Diego', 'Juan', '10:00', 'Control');
  expect(r).toEqual({ ok: true, profesional: 'Diego' });
  expect(mockSendMessage).toHaveBeenCalledWith(9999, expect.any(String), { parse_mode: 'Markdown' });
});

test('profesional web SIN Telegram: no se intenta mandar y no es un "envío fallido"', async () => {
  mockFilas = [{ telegram_user_id: '-100', nombre: 'Paula' }];
  const r = await notificarLlegadaPaciente('t1', 'Paula', 'Juan', '10:00', 'Control');
  expect(r).toEqual({ ok: false, error: 'sin_telegram', profesional: 'Paula' });
  expect(mockSendMessage).not.toHaveBeenCalled();
});

test('profesional web CON Telegram vinculado: el aviso sale a ese Telegram', async () => {
  mockFilas = [{ telegram_user_id: '-200', nombre: 'Marta' }];
  const r = await notificarLlegadaPaciente('t1', 'Marta', 'Juan', '10:00', 'Control');
  expect(r.ok).toBe(true);
  expect(mockSendMessage).toHaveBeenCalledWith(555, expect.any(String), { parse_mode: 'Markdown' });
});
