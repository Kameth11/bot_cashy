// Ítem 3.5: agenda por foto tenía 3 bugs:
//  (a) la fecha quedaba fija a "hoy", sin forma de guardar para otro día;
//  (b) guardarTurnosFlat forzaba Estado: 'Pendiente' ignorando lo leído por
//      OCR (guardarTurnosAgenda/escribirBloque ya lo respetaban);
//  (c) reenviar la misma foto (o una agenda ya cargada) duplicaba turnos: no
//      había ninguna detección de "esto ya existe" antes de addRows.
//
// Este archivo prueba guardarTurnosFlat (fecha + estado + reemplazo de
// duplicados puntuales) y detectarDuplicados con un sheet falso en memoria
// que imita la API mínima de google-spreadsheet que usa agenda.service.js.

jest.mock('../src/lib/write-queue', () => ({ runInBackground: jest.fn() }));
jest.mock('../src/config', () => ({ CONSULTORIO_MAP: {} }));

function fakeRow(data) {
  const row = {
    _data: { ...data },
    _deleted: false,
    get(col) { return row._data[col]; },
    set(col, val) { row._data[col] = val; },
    async save() {},
    async delete() { row._deleted = true; },
  };
  return row;
}

// Sheet "Turnos": almacén plano de filas (como la tab real).
function fakeTurnosSheet() {
  let rows = [];
  return {
    headerValues: ['ID_Turno', 'Fecha', 'Hora', 'Cliente', 'Servicio', 'Profesional', 'Consultorio', 'Estado'],
    async loadHeaderRow() {},
    async setHeaderRow() {},
    async addRows(filas) {
      const nuevas = filas.map(fakeRow);
      rows.push(...nuevas);
      return nuevas;
    },
    async getRows() {
      return rows.filter(r => !r._deleted);
    },
    _reset(nuevasRows) { rows = nuevasRows; },
  };
}

// Sheet "Agenda": grilla de celdas, igual que en agenda-sync.test.js.
function fakeAgendaSheet(rowCount = 40, columnCount = 60) {
  let cells = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => ({ value: null, textFormat: null }))
  );
  return {
    get rowCount() { return cells.length; },
    get columnCount() { return cells[0].length; },
    getCell(r, c) { return cells[r][c]; },
    async resize({ rowCount: rc, columnCount: cc }) {
      cells = Array.from({ length: rc }, (_, r) =>
        Array.from({ length: cc }, (_, c) => (cells[r] && cells[r][c]) || { value: null, textFormat: null })
      );
    },
    async loadCells() {},
    async saveUpdatedCells() {},
  };
}

function fakeDoc(turnosSheet, agendaSheet) {
  return {
    sheetsByTitle: { Turnos: turnosSheet, Agenda: agendaSheet },
  };
}

describe('guardarTurnosFlat', () => {
  let turnosSheet, agendaSheet, doc;

  beforeEach(() => {
    jest.resetModules();
    turnosSheet = fakeTurnosSheet();
    agendaSheet = fakeAgendaSheet();
    doc = fakeDoc(turnosSheet, agendaSheet);
    jest.doMock('../src/services/sheet.service', () => ({
      getDocCliente: jest.fn().mockResolvedValue(doc),
      invalidateCache: jest.fn(),
    }));
  });

  test('(a) guarda en la fecha indicada, no en la de hoy', async () => {
    const { guardarTurnosFlat } = require('../src/services/agenda.service');
    await guardarTurnosFlat(1, [{ hora: '10:00', cliente: 'Juan' }], '25/12/2026');
    const rows = await turnosSheet.getRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].get('Fecha')).toBe('25/12/2026');
  });

  test('(b) respeta el estado leído por OCR en vez de forzar Pendiente', async () => {
    const { guardarTurnosFlat } = require('../src/services/agenda.service');
    await guardarTurnosFlat(1, [
      { hora: '10:00', cliente: 'Juan', estado: 'Confirmado' },
      { hora: '11:00', cliente: 'Ana' }, // sin estado -> default Pendiente
    ], '25/12/2026');
    const rows = await turnosSheet.getRows();
    expect(rows.find(r => r.get('Cliente') === 'Juan').get('Estado')).toBe('Confirmado');
    expect(rows.find(r => r.get('Cliente') === 'Ana').get('Estado')).toBe('Pendiente');
  });

  test('borra los turnos indicados en idsAEliminar antes de agregar los nuevos', async () => {
    const { guardarTurnosFlat } = require('../src/services/agenda.service');
    await turnosSheet.addRows([
      { ID_Turno: 'viejo1', Fecha: '25/12/2026', Hora: '10:00', Cliente: 'Juan', Estado: 'Pendiente' },
      { ID_Turno: 'viejo2', Fecha: '25/12/2026', Hora: '12:00', Cliente: 'Pedro', Estado: 'Pendiente' },
    ]);

    await guardarTurnosFlat(1, [{ hora: '10:00', cliente: 'Juan', estado: 'Confirmado' }], '25/12/2026', ['viejo1']);

    const rows = await turnosSheet.getRows();
    // El viejo1 (Juan) fue reemplazado; el viejo2 (Pedro) sigue intacto.
    expect(rows.find(r => r.get('ID_Turno') === 'viejo1')).toBeUndefined();
    expect(rows.find(r => r.get('ID_Turno') === 'viejo2')).toBeDefined();
    const juanNuevo = rows.filter(r => r.get('Cliente') === 'Juan');
    expect(juanNuevo).toHaveLength(1);
    expect(juanNuevo[0].get('Estado')).toBe('Confirmado');
  });
});

describe('detectarDuplicados (c)', () => {
  let turnosSheet, doc;

  beforeEach(() => {
    jest.resetModules();
    turnosSheet = fakeTurnosSheet();
    doc = fakeDoc(turnosSheet, fakeAgendaSheet());
    jest.doMock('../src/services/sheet.service', () => ({
      getDocCliente: jest.fn().mockResolvedValue(doc),
      invalidateCache: jest.fn(),
    }));
  });

  test('detecta un turno ya cargado (misma hora + paciente normalizado, sin importar tildes/mayúsculas)', async () => {
    const { detectarDuplicados } = require('../src/services/agenda.service');
    await turnosSheet.addRows([
      { ID_Turno: 't1', Fecha: '25/12/2026', Hora: '10:00', Cliente: 'José Pérez', Estado: 'Pendiente' },
    ]);

    const duplicados = await detectarDuplicados(1, [
      { hora: '10:00', cliente: 'jose perez' },
      { hora: '11:00', cliente: 'Ana' },
    ], '25/12/2026');

    expect(duplicados).toHaveLength(1);
    expect(duplicados[0].nuevoIndex).toBe(0);
    expect(duplicados[0].existente.idTurno).toBe('t1');
  });

  test('no marca como duplicado un turno con distinta hora u otro paciente', async () => {
    const { detectarDuplicados } = require('../src/services/agenda.service');
    await turnosSheet.addRows([
      { ID_Turno: 't1', Fecha: '25/12/2026', Hora: '10:00', Cliente: 'Juan', Estado: 'Pendiente' },
    ]);

    const duplicados = await detectarDuplicados(1, [
      { hora: '10:30', cliente: 'Juan' },
      { hora: '10:00', cliente: 'Pedro' },
    ], '25/12/2026');

    expect(duplicados).toHaveLength(0);
  });

  test('reenviar la misma foto completa marca todos los turnos como duplicados', async () => {
    const { detectarDuplicados } = require('../src/services/agenda.service');
    await turnosSheet.addRows([
      { ID_Turno: 't1', Fecha: '25/12/2026', Hora: '10:00', Cliente: 'Juan', Estado: 'Pendiente' },
      { ID_Turno: 't2', Fecha: '25/12/2026', Hora: '11:00', Cliente: 'Ana', Estado: 'Pendiente' },
    ]);

    const duplicados = await detectarDuplicados(1, [
      { hora: '10:00', cliente: 'Juan' },
      { hora: '11:00', cliente: 'Ana' },
    ], '25/12/2026');

    expect(duplicados).toHaveLength(2);
  });
});
