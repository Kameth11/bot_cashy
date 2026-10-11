// /api/telegram/*: pedir, ver y quitar el vínculo de Telegram de una cuenta web. La cuenta sale de la sesión.

jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }));
jest.mock('../src/services/cliente.service', () => ({
  clientes: {},
  telegramVinculoSoportado: jest.fn(() => true),
  desvincularTelegram: jest.fn(async () => true),
}));

const express = require('express');
const clienteService = require('../src/services/cliente.service');
const vinculo = require('../src/services/vinculo-telegram.service');
const { registrarRutasTelegram } = require('../src/api/telegram.routes');

const WEB = '-100';
const WEB_VINCULADA = '-200';
const CUENTA_TELEGRAM = '2222';

const authMiddleware = (req, res, next) => {
  const id = req.get('x-user');
  if (!id) return res.status(401).json({ error: 'No autorizado' });
  req.user = { userId: id };
  next();
};
let bloquear = false;
let username = 'cashy_bot';

let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registrarRutasTelegram(app, {
    authMiddleware,
    rateLimit: () => (req, res, next) => (bloquear ? res.status(429).json({ error: 'Demasiados intentos' }) : next()),
    limitador: () => ({ allowed: true }),
    obtenerUsernameBot: async () => { if (!username) throw new Error('sin bot'); return username; },
  });
  await new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => {
  jest.clearAllMocks();
  vinculo._reiniciar();
  bloquear = false;
  username = 'cashy_bot';
  clienteService.telegramVinculoSoportado.mockReturnValue(true);
  clienteService.clientes = {
    [WEB]: { email: 'ana@gmail.com' },
    [WEB_VINCULADA]: { email: 'beto@gmail.com', telegramId: 555 },
    [CUENTA_TELEGRAM]: { email: 'owner@clinica.com' },
  };
});

const req = (method, path, user) => fetch(`${base}${path}`, { method, headers: user ? { 'x-user': user } : {} });

describe('GET /api/telegram/estado', () => {
  test('cuenta web sin Telegram: aplica y no está vinculado', async () => {
    expect(await (await req('GET', '/api/telegram/estado', WEB)).json()).toEqual({ aplica: true, vinculado: false, soportado: true });
  });
  test('cuenta web vinculada', async () => {
    expect(await (await req('GET', '/api/telegram/estado', WEB_VINCULADA)).json()).toEqual({ aplica: true, vinculado: true, soportado: true });
  });
  test('cuenta de Telegram: no aplica (ya ES su Telegram)', async () => {
    expect(await (await req('GET', '/api/telegram/estado', CUENTA_TELEGRAM)).json()).toEqual({ aplica: false, vinculado: false, soportado: true });
  });
  test('sin sesión: 401', async () => {
    expect((await req('GET', '/api/telegram/estado')).status).toBe(401);
  });
});

describe('POST /api/telegram/vincular', () => {
  test('crea un pedido para la cuenta de la sesión y devuelve el enlace al bot', async () => {
    const r = await req('POST', '/api/telegram/vincular', WEB);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.expiraEnSeg).toBe(600);
    const token = new URL(b.deepLink).searchParams.get('start').replace('vincular_', '');
    expect(b.deepLink).toMatch(/^https:\/\/t\.me\/cashy_bot\?start=vincular_[A-Za-z0-9_-]{16}$/);
    expect(vinculo.obtenerPedido(token)).toMatchObject({ userId: WEB });
  });

  test('una cuenta de Telegram no lo necesita: 400', async () => {
    expect((await req('POST', '/api/telegram/vincular', CUENTA_TELEGRAM)).status).toBe(400);
  });
  test('si ya tiene Telegram vinculado: 409', async () => {
    expect((await req('POST', '/api/telegram/vincular', WEB_VINCULADA)).status).toBe(409);
  });
  test('sin la migración 022: 503 con un mensaje claro', async () => {
    clienteService.telegramVinculoSoportado.mockReturnValue(false);
    const r = await req('POST', '/api/telegram/vincular', WEB);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/022/);
  });
  test('si no se puede saber el usuario del bot: 503', async () => {
    username = null;
    expect((await req('POST', '/api/telegram/vincular', WEB)).status).toBe(503);
  });
  test('con el límite de pedidos superado: 429', async () => {
    bloquear = true;
    expect((await req('POST', '/api/telegram/vincular', WEB)).status).toBe(429);
  });
  test('sin sesión: 401', async () => {
    expect((await req('POST', '/api/telegram/vincular')).status).toBe(401);
  });
});

describe('DELETE /api/telegram/vincular', () => {
  test('quita el Telegram de la cuenta de la sesión', async () => {
    expect((await req('DELETE', '/api/telegram/vincular', WEB_VINCULADA)).status).toBe(200);
    expect(clienteService.desvincularTelegram).toHaveBeenCalledWith(WEB_VINCULADA);
  });
  test('si no hay nada vinculado, o es una cuenta de Telegram: 400 y no toca nada', async () => {
    expect((await req('DELETE', '/api/telegram/vincular', WEB)).status).toBe(400);
    expect((await req('DELETE', '/api/telegram/vincular', CUENTA_TELEGRAM)).status).toBe(400);
    expect(clienteService.desvincularTelegram).not.toHaveBeenCalled();
  });
});
