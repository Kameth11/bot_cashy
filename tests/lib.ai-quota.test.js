jest.mock('../src/auth', () => ({ obtenerClientePorUserId: jest.fn() }));
const { obtenerClientePorUserId } = require('../src/auth');
const quota = require('../src/lib/ai-quota');

beforeEach(() => {
  quota.reiniciar();
  obtenerClientePorUserId.mockReset();
  process.env.AI_LIMIT_TEXTO_DIA = '3';
  process.env.AI_LIMIT_MEDIA_DIA = '1';
});
afterAll(() => { delete process.env.AI_LIMIT_TEXTO_DIA; delete process.env.AI_LIMIT_MEDIA_DIA; });

test('permite hasta el límite y corta después', () => {
  for (let i = 0; i < 3; i++) expect(quota.consumir(1, 'texto').ok).toBe(true);
  expect(quota.consumir(1, 'texto').ok).toBe(false);
});

test('avisa una sola vez por día al pasarse', () => {
  for (let i = 0; i < 3; i++) quota.consumir(1, 'texto');
  expect(quota.consumir(1, 'texto').avisar).toBe(true);
  expect(quota.consumir(1, 'texto').avisar).toBe(false);
});

test('texto y media tienen cupos separados', () => {
  expect(quota.consumir(1, 'media').ok).toBe(true);
  expect(quota.consumir(1, 'media').ok).toBe(false);
  expect(quota.consumir(1, 'texto').ok).toBe(true);
});

test('dueño e invitados comparten el cupo; otro consultorio no', () => {
  obtenerClientePorUserId.mockImplementation(id => (id === 10 || id === 11 ? { ownerId: '10' } : { ownerId: '20' }));
  for (let i = 0; i < 3; i++) expect(quota.consumir(i % 2 ? 11 : 10, 'texto').ok).toBe(true);
  expect(quota.consumir(10, 'texto').ok).toBe(false);
  expect(quota.consumir(11, 'texto').ok).toBe(false);
  expect(quota.consumir(20, 'texto').ok).toBe(true);
});

test('límite 0 = sin tope; valor inválido = default', () => {
  process.env.AI_LIMIT_TEXTO_DIA = '0';
  for (let i = 0; i < 1000; i++) expect(quota.consumir(1, 'texto').ok).toBe(true);
  process.env.AI_LIMIT_TEXTO_DIA = 'abc';
  expect(quota.limiteDe('texto')).toBe(300);
});

test('el contador se reinicia al cambiar de día', () => {
  for (let i = 0; i < 3; i++) quota.consumir(1, 'texto');
  expect(quota.consumir(1, 'texto').ok).toBe(false);
  const dateMod = require('../src/utils/date');
  const spy = jest.spyOn(dateMod, 'fechaArgentinaStr').mockReturnValue('31/12/2099');
  expect(quota.consumir(1, 'texto').ok).toBe(true);
  spy.mockRestore();
});
