// Pedidos de "Vincular Telegram": token de un solo uso, 10 minutos, un pedido activo por cuenta.

const svc = require('../src/services/vinculo-telegram.service');

beforeEach(() => svc._reiniciar());

test('crea un pedido con un token que entra en el payload de /start (máx. 64, solo A-Za-z0-9_-)', () => {
  const { token, expiraEnSeg } = svc.crearPedido(-100);
  expect(token).toMatch(/^[A-Za-z0-9_-]{16}$/);
  expect(`vincular_${token}`.length).toBeLessThanOrEqual(64);
  expect(expiraEnSeg).toBe(600);
  expect(svc.obtenerPedido(token)).toMatchObject({ userId: '-100' });
});

test('los tokens son distintos entre sí', () => {
  const tokens = new Set(Array.from({ length: 50 }, (_, i) => svc.crearPedido(-(i + 1)).token));
  expect(tokens.size).toBe(50);
});

test('vence a los 10 minutos', () => {
  const t0 = 1_000_000;
  const { token } = svc.crearPedido(-100, t0);
  expect(svc.obtenerPedido(token, t0 + 9 * 60 * 1000)).not.toBeNull();
  expect(svc.obtenerPedido(token, t0 + 10 * 60 * 1000)).toBeNull();
});

test('se usa una sola vez', () => {
  const { token } = svc.crearPedido(-100);
  svc.consumir(token);
  expect(svc.obtenerPedido(token)).toBeNull();
});

test('un pedido nuevo de la misma cuenta invalida el anterior (uno activo a la vez)', () => {
  const a = svc.crearPedido(-100);
  const b = svc.crearPedido(-100);
  expect(svc.obtenerPedido(a.token)).toBeNull();
  expect(svc.obtenerPedido(b.token)).not.toBeNull();
  // pero no afecta a otras cuentas
  const otra = svc.crearPedido(-200);
  expect(svc.obtenerPedido(b.token)).not.toBeNull();
  expect(svc.obtenerPedido(otra.token)).not.toBeNull();
});

test('un token inventado o vacío no resuelve nada', () => {
  expect(svc.obtenerPedido('inventado')).toBeNull();
  expect(svc.obtenerPedido('')).toBeNull();
  expect(svc.obtenerPedido(undefined)).toBeNull();
});
