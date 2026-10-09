jest.mock('../src/lib/telegraf', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } },
}));
jest.mock('../src/services/db.service', () => ({
  deleteMovimiento: jest.fn().mockResolvedValue(undefined),
  deleteMovimientoByKey: jest.fn(),
  addRow: jest.fn().mockResolvedValue({}),
}));
jest.mock('../src/services/sheet.service', () => ({
  obtenerDatosSheet: jest.fn().mockResolvedValue([{ idUnico: 'YA-EXISTE' }]),
  getSheetId: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const db = require('../src/services/db.service');
const { app, JWT_SECRET } = require('../src/api/index.js');

const token = jwt.sign({ userId: '123456', type: 'dashboard' }, JWT_SECRET, { expiresIn: '1h' });

const mov = (extra = {}) => ({
  idUnico: 'MOV-1', fecha: '04/05/2026', hora: '10:30', descripcion: 'prueba larga',
  monto: -5000, montoPesos: -5000, tipo: 'Egreso', moneda: 'Pesos', estado: 'Pendiente',
  metodoPago: 'efectivo', ...extra,
});

describe('POST /api/movimientos/restaurar (deshacer borrado)', () => {
  let server; let baseUrl;
  beforeAll(async () => {
    await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
  });
  afterAll(() => new Promise((r) => server.close(r)));
  beforeEach(() => db.addRow.mockClear());

  const post = (body) => fetch(`${baseUrl}/api/movimientos/restaurar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  test('vuelve a cargar el movimiento con su ID, fecha y hora originales', async () => {
    const res = await post({ movimientos: [mov()] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, restaurados: 1, fallidos: [] });
    const rowData = db.addRow.mock.calls[0][1];
    expect(rowData).toMatchObject({
      ID_Unico: 'MOV-1', Fecha: '04/05/2026', Hora: '10:30', Monto: -5000,
      Estado: 'Pendiente', Tipo: 'Egreso', MetodoPago: 'efectivo',
    });
  });

  test('no duplica un movimiento cuyo ID ya existe', async () => {
    const res = await post({ movimientos: [mov({ idUnico: 'YA-EXISTE' })] });
    expect((await res.json()).restaurados).toBe(1);
    expect(db.addRow).not.toHaveBeenCalled();
  });

  test('rechaza datos inválidos y listas vacías o enormes', async () => {
    expect((await post({ movimientos: [] })).status).toBe(400);
    expect((await post({ movimientos: [mov({ monto: 0 })] })).status).toBe(400);
    expect((await post({ movimientos: [mov({ tipo: 'Otro' })] })).status).toBe(400);
    expect((await post({ movimientos: [mov({ idUnico: '' })] })).status).toBe(400);
    expect((await post({ movimientos: Array.from({ length: 201 }, (_, i) => mov({ idUnico: `X${i}` })) })).status).toBe(400);
    expect(db.addRow).not.toHaveBeenCalled();
  });
});

describe('POST /api/movimientos/eliminar-lote', () => {
  let server; let baseUrl;
  beforeAll(async () => {
    await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
  });
  afterAll(() => new Promise((r) => server.close(r)));

  test('borra cada ID y informa los que fallaron', async () => {
    db.deleteMovimiento.mockClear();
    db.deleteMovimiento.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('movimiento_no_encontrado'));
    const res = await fetch(`${baseUrl}/api/movimientos/eliminar-lote`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['A', 'B', 'A'] }),
    });
    expect(await res.json()).toMatchObject({ ok: true, eliminados: 1, fallidos: ['B'] });
    expect(db.deleteMovimiento).toHaveBeenCalledTimes(2);
  });
});
