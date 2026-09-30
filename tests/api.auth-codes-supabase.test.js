// Con Supabase disponible, el código de acceso se lee de auth_codes (fuente de
// verdad): un código pedido en otra instancia / antes de un redeploy verifica.

jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } } }));

let mockFila = null;
const mockUpdates = [];
jest.mock('../src/lib/supabase', () => ({
  isAvailable: () => true,
  getSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mockFila, error: null }) }) }),
      update: (v) => ({ eq: async () => { mockUpdates.push(v); return { error: null }; } }),
      upsert: async () => ({ error: null }),
    }),
  }),
}));

const { app, authCodes } = require('../src/api/index.js');

let server, base;
beforeAll(async () => { await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }); });
afterAll(() => new Promise(r => server.close(r)));

const verify = (userId, code) => fetch(`${base}/api/auth/verify`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, code }),
});

test('verifica un código que solo existe en Supabase (memoria vacía)', async () => {
  authCodes.clear();
  mockFila = { code: '123456', expires_at: new Date(Date.now() + 60000).toISOString(), used: false, intentos: 0 };
  const res = await verify('123456', '123456'); // AUTHORIZED_USER_ID de setup-env
  expect(res.status).toBe(200);
  expect((await res.json()).token).toBeTruthy();
  expect(mockUpdates).toContainEqual({ used: true });
});

test('un código ya usado en Supabase no se puede reusar aunque la memoria lo tenga sin usar', async () => {
  authCodes.set('123456', { code: '654321', expiresAt: new Date(Date.now() + 60000), used: false, intentos: 0 });
  mockFila = { code: '654321', expires_at: new Date(Date.now() + 60000).toISOString(), used: true, intentos: 0 };
  const res = await verify('123456', '654321');
  expect(res.status).toBe(400);
});
