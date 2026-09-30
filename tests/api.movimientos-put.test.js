jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } },
}));
jest.mock('../src/services/db.service', () => ({
  updateMovimiento: jest.fn().mockResolvedValue(undefined),
  deleteMovimiento: jest.fn(),
  deleteMovimientoByKey: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const db = require('../src/services/db.service');
const { app, JWT_SECRET } = require('../src/api/index.js');

// AUTHORIZED_USER_ID (setup-env) = 123456 → admin, con todos los permisos.
const token = jwt.sign({ userId: '123456', type: 'dashboard' }, JWT_SECRET, { expiresIn: '1h' });

describe('PUT /api/movimientos/:id — validación', () => {
  let server; let baseUrl;
  beforeAll(async () => {
    await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
  });
  afterAll(() => new Promise((r) => server.close(r)));
  beforeEach(() => db.updateMovimiento.mockClear());

  const put = (body) => fetch(`${baseUrl}/api/movimientos/abc`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  test('rechaza monto inválido (NaN, 0, texto)', async () => {
    for (const monto of ['abc', 0, null, 1e12]) {
      const res = await put({ monto });
      expect(res.status).toBe(400);
    }
    expect(db.updateMovimiento).not.toHaveBeenCalled();
  });

  test('rechaza descripción demasiado corta', async () => {
    expect((await put({ descripcion: 'a' })).status).toBe(400);
    expect(db.updateMovimiento).not.toHaveBeenCalled();
  });

  test('sanitiza la descripción: prefijo anti-fórmula y tope de largo', async () => {
    const res = await put({ descripcion: '=HYPERLINK("http://x")' });
    expect(res.status).toBe(200);
    expect(db.updateMovimiento.mock.calls[0][2].descripcion.startsWith("'=")).toBe(true);

    await put({ descripcion: 'x'.repeat(500) });
    expect(db.updateMovimiento.mock.calls[1][2].descripcion.length).toBeLessThanOrEqual(121);
  });

  test('método de pago fuera de la lista se guarda vacío', async () => {
    await put({ metodoPago: 'bitcoin' });
    expect(db.updateMovimiento.mock.calls[0][2].metodoPago).toBe('');
  });
});
