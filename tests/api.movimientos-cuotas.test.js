// POST /api/movimientos con plan de cuotas, y PUT con todos los campos editables.

jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: jest.fn().mockResolvedValue(true) } } }));
jest.mock('../src/services/db.service', () => ({
  updateMovimiento: jest.fn().mockResolvedValue(undefined),
  deleteMovimiento: jest.fn().mockResolvedValue(undefined),
  deleteMovimientoByKey: jest.fn(),
}));
jest.mock('../src/services/movimiento.service', () => ({
  ...jest.requireActual('../src/services/movimiento.service'),
  guardarMovimiento: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const db = require('../src/services/db.service');
const { guardarMovimiento } = require('../src/services/movimiento.service');
const { app, JWT_SECRET } = require('../src/api/index.js');

const token = jwt.sign({ userId: '123456', type: 'dashboard' }, JWT_SECRET, { expiresIn: '1h' });

let server; let baseUrl;
beforeAll(async () => {
  await new Promise((r) => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
afterAll(() => new Promise((r) => server.close(r)));

let seq;
beforeEach(() => {
  jest.clearAllMocks();
  seq = 0;
  guardarMovimiento.mockImplementation(async () => ({ idUnico: `ID-${++seq}` }));
  db.deleteMovimiento.mockResolvedValue(undefined);
});

const post = (body) => fetch(`${baseUrl}/api/movimientos`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const put = (body) => fetch(`${baseUrl}/api/movimientos/abc`, {
  method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const base = { tipo: 'Ingreso', descripcion: 'Ortodoncia', monto: 300000, moneda: 'Pesos', metodoPago: 'efectivo', categoria: 'cuota', paciente: 'Ana' };
const llamada = (i) => guardarMovimiento.mock.calls[i][1];

describe('POST /api/movimientos — plan de cuotas', () => {
  test('el monto es el TOTAL: 6 cuotas de 50.000, la primera cobrada y el resto pendientes mes a mes', async () => {
    const r = await post({ ...base, cuotas: { cantidad: 6, primeraCobrada: true, primerVencimiento: '2026-10-11' } });
    expect(r.status).toBe(201);
    const b = await r.json();
    expect(b.cuotas).toBe(6);
    expect(b.movimientos.map(m => m.idUnico)).toEqual(['ID-1', 'ID-2', 'ID-3', 'ID-4', 'ID-5', 'ID-6']);

    expect(guardarMovimiento).toHaveBeenCalledTimes(6);
    const llamadas = [0, 1, 2, 3, 4, 5].map(llamada);
    expect(llamadas.map(c => c.descripcion)).toEqual([1, 2, 3, 4, 5, 6].map(n => `Ortodoncia (cuota ${n}/6)`));
    expect(llamadas.every(c => c.monto === 50000 && c.tipo === 'Ingreso' && c.moneda === 'Pesos')).toBe(true);
    expect(llamadas.map(c => c.estado)).toEqual(['Cobrado', 'Pendiente', 'Pendiente', 'Pendiente', 'Pendiente', 'Pendiente']);
    expect(llamadas.map(c => c.fechaVencimiento)).toEqual(['2026-10-11', '2026-11-11', '2026-12-11', '2027-01-11', '2027-02-11', '2027-03-11']);
    // Lo que se cobró hoy lleva el método de pago; las pendientes todavía no se pagaron.
    expect(llamadas.map(c => c.metodoPago)).toEqual(['efectivo', '', '', '', '', '']);
    // Los datos del paciente y la categoría van en todas.
    expect(llamadas.every(c => c.categoria === 'cuota' && c.pacienteNombre === 'Ana')).toBe(true);
  });

  test('con la primera sin cobrar, todas quedan pendientes', async () => {
    await post({ ...base, cuotas: { cantidad: 3, primeraCobrada: false, primerVencimiento: '2026-10-11' } });
    expect([0, 1, 2].map(i => llamada(i).estado)).toEqual(['Pendiente', 'Pendiente', 'Pendiente']);
    expect([0, 1, 2].map(i => llamada(i).metodoPago)).toEqual(['', '', '']);
  });

  test('si no se pide lo contrario, la primera queda cobrada', async () => {
    await post({ ...base, cuotas: { cantidad: 2, primerVencimiento: '2026-10-11' } });
    expect(llamada(0).estado).toBe('Cobrado');
  });

  test('si no se indica el primer vencimiento, arranca hoy', async () => {
    await post({ ...base, cuotas: { cantidad: 2 } });
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    expect(llamada(0).fechaVencimiento).toBe(hoy);
  });

  test('si no divide exacto, la última absorbe el redondeo y la suma es el total', async () => {
    await post({ ...base, monto: 100, cuotas: { cantidad: 3, primerVencimiento: '2026-10-11' } });
    const montos = [0, 1, 2].map(i => llamada(i).monto);
    expect(montos).toEqual([33.33, 33.33, 33.34]);
    expect(Math.round(montos.reduce((a, b) => a + b, 0) * 100) / 100).toBe(100);
  });

  test('en dólares: el total es en dólares y cada cuota también', async () => {
    await post({ ...base, moneda: 'Dólares', monto: 600, cuotas: { cantidad: 3, primerVencimiento: '2026-10-11' } });
    expect([0, 1, 2].map(i => llamada(i).monto)).toEqual([200, 200, 200]);
    expect(llamada(0).moneda).toBe('Dólares');
  });

  test('una sola cuota es un movimiento normal, sin sufijo', async () => {
    const r = await post({ ...base, cuotas: { cantidad: 1 } });
    expect(r.status).toBe(201);
    expect(guardarMovimiento).toHaveBeenCalledTimes(1);
    expect(llamada(0).descripcion).toBe('Ortodoncia');
    expect(llamada(0).monto).toBe(300000);
    expect(llamada(0).estado).toBe('Cobrado');
  });

  test('sin "cuotas" todo sigue igual que siempre', async () => {
    const r = await post({ ...base, estado: 'Pendiente', fechaVencimiento: '2026-11-01' });
    expect(r.status).toBe(201);
    expect(guardarMovimiento).toHaveBeenCalledTimes(1);
    expect(llamada(0)).toMatchObject({ descripcion: 'Ortodoncia', monto: 300000, estado: 'Pendiente', fechaVencimiento: '2026-11-01' });
  });

  test('las cuotas son solo para ingresos', async () => {
    const r = await post({ ...base, tipo: 'Egreso', cuotas: { cantidad: 3 } });
    expect(r.status).toBe(400);
    expect(guardarMovimiento).not.toHaveBeenCalled();
  });

  test.each([[25], [0], [-3], ['abc'], [null], [3.5 + 30]])('cantidad inválida (%p): 400 y no se guarda nada', async (cantidad) => {
    const r = await post({ ...base, cuotas: { cantidad } });
    expect(r.status).toBe(400);
    expect(guardarMovimiento).not.toHaveBeenCalled();
  });

  test('un primer vencimiento inválido: 400', async () => {
    expect((await post({ ...base, cuotas: { cantidad: 3, primerVencimiento: '11/10/2026' } })).status).toBe(400);
    expect((await post({ ...base, cuotas: { cantidad: 3, primerVencimiento: '2026-02-30' } })).status).toBe(400);
    expect(guardarMovimiento).not.toHaveBeenCalled();
  });

  test('el monto del total se valida como siempre', async () => {
    expect((await post({ ...base, monto: 0, cuotas: { cantidad: 3 } })).status).toBe(400);
    expect((await post({ ...base, monto: 'abc', cuotas: { cantidad: 3 } })).status).toBe(400);
  });

  test('si falla a mitad de camino, se deshace lo creado: nunca queda un plan a medias', async () => {
    guardarMovimiento
      .mockResolvedValueOnce({ idUnico: 'A' })
      .mockResolvedValueOnce({ idUnico: 'B' })
      .mockRejectedValueOnce(new Error('sheet caído'));
    const r = await post({ ...base, cuotas: { cantidad: 5, primerVencimiento: '2026-10-11' } });
    expect(r.status).toBe(500);
    expect((await r.json()).error).toMatch(/No se guardó ninguna/);
    expect(guardarMovimiento).toHaveBeenCalledTimes(3);
    expect(db.deleteMovimiento.mock.calls.map(c => c[1])).toEqual(['A', 'B']);
  });

  test('si una cuota devuelve vacío (no se pudo guardar), también se deshace', async () => {
    guardarMovimiento.mockResolvedValueOnce({ idUnico: 'A' }).mockResolvedValueOnce(null);
    const r = await post({ ...base, cuotas: { cantidad: 3, primerVencimiento: '2026-10-11' } });
    expect(r.status).toBe(500);
    expect(db.deleteMovimiento.mock.calls.map(c => c[1])).toEqual(['A']);
  });

  test('si además falla el deshacer, igual responde el error (no se cuelga)', async () => {
    guardarMovimiento.mockResolvedValueOnce({ idUnico: 'A' }).mockRejectedValueOnce(new Error('boom'));
    db.deleteMovimiento.mockRejectedValueOnce(new Error('tampoco'));
    expect((await post({ ...base, cuotas: { cantidad: 3, primerVencimiento: '2026-10-11' } })).status).toBe(500);
  });
});

describe('PUT /api/movimientos/:id — todos los campos', () => {
  const enviado = () => db.updateMovimiento.mock.calls[0][2];

  test('acepta tipo, categoría y los datos de paciente, profesional, tratamiento y proveedor', async () => {
    const r = await put({ tipo: 'Egreso', categoria: 'insumos', paciente: 'Ana', profesional: 'Laura', tratamiento: 'Limpieza', proveedor: 'MediSupply' });
    expect(r.status).toBe(200);
    expect(enviado()).toEqual({ tipo: 'Egreso', categoria: 'insumos', paciente: 'Ana', profesional: 'Laura', tratamiento: 'Limpieza', proveedor: 'MediSupply' });
  });

  test('un tipo inválido se rechaza', async () => {
    expect((await put({ tipo: 'Gasto' })).status).toBe(400);
    expect((await put({ tipo: 'liquidacion' })).status).toBe(400);
    expect(db.updateMovimiento).not.toHaveBeenCalled();
  });

  test('las fechas llegan como AAAA-MM-DD o DD/MM/AAAA y se guardan como DD/MM/AAAA', async () => {
    await put({ fecha: '2026-10-07', fechaPrestacion: '06/10/2026', fechaVencimiento: '2026-11-07' });
    expect(enviado()).toEqual({ fecha: '07/10/2026', fechaPrestacion: '06/10/2026', fechaVencimiento: '07/11/2026' });
  });

  test('la prestación y el vencimiento se pueden vaciar; la fecha del movimiento no', async () => {
    await put({ fecha: '', fechaPrestacion: '', fechaVencimiento: '', descripcion: 'Consulta' });
    expect(enviado()).toEqual({ descripcion: 'Consulta', fechaPrestacion: '', fechaVencimiento: '' });
  });

  test.each([['fecha', '2026-02-30'], ['fecha', 'ayer'], ['fechaPrestacion', '31/02/2026'], ['fechaVencimiento', '2026-13-01']])('fecha inválida (%s=%p): 400', async (campo, valor) => {
    expect((await put({ [campo]: valor })).status).toBe(400);
    expect(db.updateMovimiento).not.toHaveBeenCalled();
  });

  test('un texto se puede vaciar, y se sanitiza igual que al crear (anti fórmula, tope de largo)', async () => {
    await put({ categoria: '', paciente: '=HYPERLINK("http://x")', tratamiento: 'x'.repeat(500) });
    const e = enviado();
    expect(e.categoria).toBe('');
    expect(e.paciente.startsWith("'=")).toBe(true);
    expect(e.tratamiento.length).toBeLessThanOrEqual(101);
  });

  test('"Pagado" (el estado de un egreso) se guarda como Cobrado: antes se descartaba en silencio', async () => {
    await put({ estado: 'Pagado' });
    expect(enviado()).toEqual({ estado: 'Cobrado' });
  });

  test('los estados de siempre siguen igual, y uno inventado se ignora', async () => {
    await put({ estado: 'Cobrado' });
    expect(db.updateMovimiento.mock.calls[0][2]).toEqual({ estado: 'Cobrado' });
    await put({ estado: 'Pendiente' });
    expect(db.updateMovimiento.mock.calls[1][2]).toEqual({ estado: 'Pendiente' });
    expect((await put({ estado: 'Inventado' })).status).toBe(400); // queda sin campos válidos
  });

  test('un pedido sin ningún campo válido sigue siendo 400', async () => {
    expect((await put({})).status).toBe(400);
    expect((await put({ idMov: 'x', user_id: 'otro' })).status).toBe(400);
  });
});
