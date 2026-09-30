jest.mock('../src/services/sheet.service', () => ({ obtenerDatosSheet: jest.fn(), getSheetCliente: jest.fn(), invalidateCache: jest.fn() }));
jest.mock('../src/services/db.service', () => ({ getRows: jest.fn(), addRow: jest.fn() }));
jest.mock('../src/services/sheet-format.service', () => ({ aplicarColorMontoEnFila: jest.fn() }));
jest.mock('../src/services/cotizacion.service', () => ({ obtenerCotizacionDolar: jest.fn() }));
jest.mock('../src/services/movimiento.service', () => ({ calcularMontoPesos: jest.fn(), crearMensajeMovimientoRegistrado: jest.fn(), guardarMovimiento: jest.fn() }));

const db = require('../src/services/db.service');
const { buscarPendientesDePagador } = require('../src/services/command.service');

const fila = (o) => ({ get: (k) => ({ Estado: 'Pendiente', Tipo: 'Ingreso', Moneda: 'Pesos', Descripcion: '', Paciente: '', Pagador: '', ...o })[k] });

test('matchea por palabras del nombre, ignora tildes/mayúsculas y ordena por coincidencias', async () => {
  const a = fila({ Descripcion: 'Consulta Juan' });
  const b = fila({ Descripcion: 'Limpieza', Paciente: 'Juan Carlos Pérez' });
  const c = fila({ Descripcion: 'Consulta María' });
  db.getRows.mockResolvedValue([a, b, c]);
  const r = await buscarPendientesDePagador(1, 'JUAN CARLOS PEREZ');
  expect(r).toEqual([b, a]); // b coincide en 3 palabras, a en 1; c no
});

test('descarta cobrados, egresos y otra moneda', async () => {
  db.getRows.mockResolvedValue([
    fila({ Descripcion: 'Juan', Estado: 'Cobrado' }),
    fila({ Descripcion: 'Juan', Tipo: 'Egreso' }),
    fila({ Descripcion: 'Juan', Moneda: 'Dólares' }),
  ]);
  expect(await buscarPendientesDePagador(1, 'Juan Perez')).toEqual([]);
});

test('nombre vacío o solo palabras irrelevantes: no busca', async () => {
  db.getRows.mockResolvedValue([fila({ Descripcion: 'de la sa' })]);
  expect(await buscarPendientesDePagador(1, '')).toEqual([]);
  expect(await buscarPendientesDePagador(1, 'de la SA')).toEqual([]);
  expect(await buscarPendientesDePagador(1, null)).toEqual([]);
});

test('respeta el límite', async () => {
  db.getRows.mockResolvedValue(Array.from({ length: 9 }, () => fila({ Descripcion: 'Juan' })));
  expect(await buscarPendientesDePagador(1, 'Juan', { limite: 3 })).toHaveLength(3);
});
