// A qué chat de Telegram se le escribe a una persona: su ID si nació en Telegram; el Telegram
// vinculado si nació en la web; nadie si es una cuenta web sin Telegram.

jest.mock('../src/services/cliente.service', () => ({ clientes: {} }));

const clienteService = require('../src/services/cliente.service');
const { chatIdDe } = require('../src/lib/telegram-destino');

beforeEach(() => {
  clienteService.clientes = {
    '-100': { email: 'web-sin-telegram@gmail.com' },
    '-200': { email: 'web-vinculada@gmail.com', telegramId: 555 },
  };
});

test('una cuenta de Telegram (ID positivo) es su propio chat', () => {
  expect(chatIdDe(1234)).toBe(1234);
  expect(chatIdDe('1234')).toBe(1234);
});

test('una cuenta web con Telegram vinculado: el aviso sale a ese Telegram', () => {
  expect(chatIdDe(-200)).toBe(555);
  expect(chatIdDe('-200')).toBe(555);
});

test('una cuenta web SIN Telegram no tiene a dónde recibir (null, nunca el ID negativo)', () => {
  expect(chatIdDe(-100)).toBeNull();
  expect(chatIdDe(-999)).toBeNull(); // ni existe
});

test('entradas inválidas', () => {
  expect(chatIdDe(null)).toBeNull();
  expect(chatIdDe(undefined)).toBeNull();
  expect(chatIdDe('abc')).toBeNull();
  expect(chatIdDe(0)).toBeNull();
});
