const { renderizarSeccionFecha } = require('../src/services/agenda.service');

// Sheet falso en memoria que imita lo que usa renderizarSeccionFecha:
// rowCount, columnCount y getCell(r,c) con .value asignable.
function fakeSheet(rowCount = 40, columnCount = 60) {
  const cells = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => ({ value: null, textFormat: null }))
  );
  return {
    rowCount,
    columnCount,
    getCell(r, c) { return cells[r][c]; },
    _cells: cells,
  };
}

// Devuelve, para un bloque cuyo título arranca en (titleRow, col), las filas
// de datos (Hora|Cliente|Servicio|Estado|Fecha) que tengan contenido.
function leerBloque(sheet, titleRow, col) {
  const label = sheet.getCell(titleRow, col).value;
  const filas = [];
  for (let r = titleRow + 2; r < sheet.rowCount; r++) {
    const hora = sheet.getCell(r, col).value;
    if (hora === null || hora === '') break;
    filas.push({
      hora,
      cliente: sheet.getCell(r, col + 1).value,
      servicio: sheet.getCell(r, col + 2).value,
      estado: sheet.getCell(r, col + 3).value,
      fecha: sheet.getCell(r, col + 4).value,
    });
  }
  return { label, filas };
}

const FECHA = '24/06/2026';

describe('renderizarSeccionFecha', () => {
  test('escribe una sección nueva con un bloque por consultorio', () => {
    const sheet = fakeSheet();
    const turnos = [
      { hora: '09:00', cliente: 'Juan', servicio: 'Limpieza', estado: 'Pendiente', consultorio: 'Consultorio 1', profesional: 'Laura' },
      { hora: '10:00', cliente: 'Maria', servicio: 'Conducto', estado: 'Llegó', consultorio: 'Consultorio 1', profesional: 'Laura' },
      { hora: '09:30', cliente: 'Pedro', servicio: 'Control', estado: 'Cobrado', consultorio: 'Consultorio 2', profesional: 'Diego' },
    ];

    renderizarSeccionFecha(sheet, FECHA, turnos);

    // Bloque 1 arranca con título en (0,0); bloque 2 a 6 columnas (BLOCK_WIDTH+SPACING).
    const b1 = leerBloque(sheet, 0, 0);
    const b2 = leerBloque(sheet, 0, 6);
    expect(b1.label).toContain('Consultorio 1');
    expect(b1.filas).toHaveLength(2);
    expect(b1.filas.map(f => f.cliente)).toEqual(['Juan', 'Maria']);
    expect(b1.filas.every(f => f.fecha === FECHA)).toBe(true);
    expect(b2.label).toContain('Consultorio 2');
    expect(b2.filas).toHaveLength(1);
    expect(b2.filas[0].cliente).toBe('Pedro');
  });

  test('reescribe en el mismo lugar reflejando un cambio de estado', () => {
    const sheet = fakeSheet();
    const turnos = [
      { hora: '09:00', cliente: 'Juan', servicio: 'Limpieza', estado: 'Pendiente', consultorio: 'Consultorio 1', profesional: 'Laura' },
    ];
    renderizarSeccionFecha(sheet, FECHA, turnos);
    expect(leerBloque(sheet, 0, 0).filas[0].estado).toBe('Pendiente');

    // Simula "Llegó": mismo turno, nuevo estado. Debe quedar UNA sola fila.
    renderizarSeccionFecha(sheet, FECHA, [{ ...turnos[0], estado: 'Llegó' }]);
    const b = leerBloque(sheet, 0, 0);
    expect(b.filas).toHaveLength(1);
    expect(b.filas[0].estado).toBe('Llegó');
  });

  test('al borrar un turno la sección se achica (no quedan filas fantasma)', () => {
    const sheet = fakeSheet();
    const turnos = [
      { hora: '09:00', cliente: 'Juan', servicio: 'Limpieza', estado: 'Pendiente', consultorio: 'Consultorio 1', profesional: 'Laura' },
      { hora: '10:00', cliente: 'Maria', servicio: 'Conducto', estado: 'Pendiente', consultorio: 'Consultorio 1', profesional: 'Laura' },
    ];
    renderizarSeccionFecha(sheet, FECHA, turnos);
    expect(leerBloque(sheet, 0, 0).filas).toHaveLength(2);

    // Borramos a Maria: queda solo Juan.
    renderizarSeccionFecha(sheet, FECHA, [turnos[0]]);
    const b = leerBloque(sheet, 0, 0);
    expect(b.filas).toHaveLength(1);
    expect(b.filas[0].cliente).toBe('Juan');
  });

  test('borrar todos los turnos deja la sección vacía', () => {
    const sheet = fakeSheet();
    renderizarSeccionFecha(sheet, FECHA, [
      { hora: '09:00', cliente: 'Juan', servicio: 'Limpieza', estado: 'Pendiente', consultorio: 'Consultorio 1', profesional: 'Laura' },
    ]);
    renderizarSeccionFecha(sheet, FECHA, []);

    // No debe quedar ningún rastro de la fecha en la grilla.
    let quedaAlgo = false;
    for (let r = 0; r < sheet.rowCount; r++) {
      for (let c = 0; c < sheet.columnCount; c++) {
        const v = sheet.getCell(r, c).value;
        if (v !== null && v !== '') quedaAlgo = true;
      }
    }
    expect(quedaAlgo).toBe(false);
  });

  test('no pisa la sección de otra fecha que está debajo', () => {
    const sheet = fakeSheet();
    const otraFecha = '25/06/2026';
    // Escribimos primero la fecha de abajo, después la de arriba, y volvemos a
    // renderizar la de arriba (simulando un update). La de abajo debe sobrevivir.
    renderizarSeccionFecha(sheet, FECHA, [
      { hora: '09:00', cliente: 'Juan', servicio: 'Limpieza', estado: 'Pendiente', consultorio: 'Consultorio 1', profesional: 'Laura' },
    ]);
    renderizarSeccionFecha(sheet, otraFecha, [
      { hora: '11:00', cliente: 'Ana', servicio: 'Control', estado: 'Pendiente', consultorio: 'Consultorio 1', profesional: 'Laura' },
    ]);

    // Update sobre la primera fecha.
    renderizarSeccionFecha(sheet, FECHA, [
      { hora: '09:00', cliente: 'Juan', servicio: 'Limpieza', estado: 'Cobrado', consultorio: 'Consultorio 1', profesional: 'Laura' },
    ]);

    // La segunda fecha sigue presente en algún lado de la grilla.
    let encontroOtraFecha = false;
    for (let r = 0; r < sheet.rowCount; r++) {
      for (let c = 0; c < sheet.columnCount; c++) {
        if (sheet.getCell(r, c).value === 'Ana') encontroOtraFecha = true;
      }
    }
    expect(encontroOtraFecha).toBe(true);
  });
});
