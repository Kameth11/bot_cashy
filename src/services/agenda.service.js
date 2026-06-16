const { getDocCliente, invalidateCache } = require('./sheet.service');

// ── Tab "Turnos" — estructura plana, consultable por fecha ──

const TURNOS_COLS = ['ID_Turno', 'Fecha', 'Hora', 'Cliente', 'Servicio', 'Profesional', 'Consultorio', 'Estado'];

function generarIDTurno() {
  return `turno_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

function fechaHoyStr() {
  const now = new Date();
  return `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
}

async function crearTabTurnosSiNoExiste(userId) {
  const doc = await getDocCliente(userId, true);
  if (!doc) return null;
  try {
    if (doc.sheetsByTitle['Turnos']) {
      return doc.sheetsByTitle['Turnos'];
    }
    console.log('Creando tab Turnos...');
    const sheet = await doc.addSheet({ title: 'Turnos' });
    await sheet.setHeaderRow(TURNOS_COLS);
    await sheet.loadHeaderRow();
    console.log('Tab Turnos creada OK');
    return sheet;
  } catch (err) {
    console.error('Error al crear tab Turnos:', err.message);
    return null;
  }
}

async function guardarTurnosFlat(userId, turnos) {
  const sheet = await crearTabTurnosSiNoExiste(userId);
  if (!sheet) throw new Error('No se pudo acceder a la tab Turnos');

  const fecha = fechaHoyStr();
  const ids = [];
  console.log(`Guardando ${turnos.length} turnos en tab Turnos (${fecha})...`);

  for (const turno of turnos) {
    const idTurno = generarIDTurno();
    ids.push(idTurno);
    await sheet.addRow({
      ID_Turno: idTurno,
      Fecha: fecha,
      Hora: turno.hora || '',
      Cliente: turno.cliente || '',
      Servicio: turno.servicio || '',
      Profesional: turno.profesional || '',
      Consultorio: turno.consultorio || '',
      Estado: 'Pendiente',
    });
  }

  return ids;
}

async function obtenerTurnosPorFecha(userId, fechaStr) {
  const sheet = await crearTabTurnosSiNoExiste(userId);
  if (!sheet) return [];
  const rows = await sheet.getRows();
  return rows
    .filter(r => r.get('Fecha') === fechaStr)
    .map(r => ({
      idTurno: r.get('ID_Turno'),
      fecha: r.get('Fecha'),
      hora: r.get('Hora'),
      cliente: r.get('Cliente'),
      servicio: r.get('Servicio'),
      profesional: r.get('Profesional'),
      consultorio: r.get('Consultorio'),
      estado: r.get('Estado'),
    }));
}

async function actualizarEstadoTurno(userId, idTurno, nuevoEstado) {
  const sheet = await crearTabTurnosSiNoExiste(userId);
  if (!sheet) throw new Error('No se pudo acceder a la tab Turnos');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('ID_Turno') === idTurno);
  if (!row) throw new Error(`Turno ${idTurno} no encontrado`);
  row.set('Estado', nuevoEstado);
  await row.save();
}

async function actualizarDatosTurno(userId, idTurno, datos) {
  const sheet = await crearTabTurnosSiNoExiste(userId);
  if (!sheet) throw new Error('No se pudo acceder a la tab Turnos');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('ID_Turno') === idTurno);
  if (!row) throw new Error('turno_no_encontrado');
  const campos = { Cliente: datos.cliente, Servicio: datos.servicio, Profesional: datos.profesional, Hora: datos.hora };
  for (const [col, val] of Object.entries(campos)) {
    if (val !== undefined) row.set(col, val);
  }
  await row.save();
}

const BLOCK_WIDTH = 5;
const BLOCK_SPACING = 1;
const BLOCK_HEADERS = ['Hora', 'Cliente', 'Servicio', 'Estado', 'Fecha'];

function indexToColumnLetter(index) {
  let current = index + 1;
  let result = '';

  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }

  return result;
}

function getBlockLabel(turno) {
  const consultorio = turno.consultorio ? String(turno.consultorio).trim() : '';
  const profesional = turno.profesional ? String(turno.profesional).trim() : '';

  if (consultorio && profesional) return `${consultorio} - ${profesional}`;
  if (consultorio) return consultorio;
  if (profesional) return profesional;
  return 'A confirmar';
}

function agruparTurnos(turnos) {
  const groups = [];
  const byLabel = new Map();

  for (const turno of turnos) {
    const label = getBlockLabel(turno);

    if (!byLabel.has(label)) {
      const group = { label, turnos: [] };
      byLabel.set(label, group);
      groups.push(group);
    }

    byLabel.get(label).turnos.push(turno);
  }

  return groups;
}

async function crearTabAgendaSiNoExiste(userId) {
  const docCliente = await getDocCliente(userId, true);
  if (!docCliente) return null;

  try {
    let agendaSheet = docCliente.sheetsByTitle['Agenda'];
    if (!agendaSheet) {
      agendaSheet = await docCliente.addSheet({
        title: 'Agenda',
        rowCount: 300,
        columnCount: 30,
      });
      console.log('Tab Agenda creado');
    }
    return agendaSheet;
  } catch (error) {
    console.error('Error al crear tab Agenda:', error.message);
    return null;
  }
}

async function asegurarTamanoSheet(sheet, requiredColumns, requiredRows) {
  const newColumnCount = Math.max(sheet.columnCount, requiredColumns);
  const newRowCount = Math.max(sheet.rowCount, requiredRows);

  if (newColumnCount !== sheet.columnCount || newRowCount !== sheet.rowCount) {
    await sheet.resize({ rowCount: newRowCount, columnCount: newColumnCount });
  }
}

async function getNextStartRow(sheet) {
  await sheet.loadCells();
  let lastUsedRow = 0;

  for (let rowIndex = 0; rowIndex < sheet.rowCount; rowIndex++) {
    let rowHasValue = false;

    for (let colIndex = 0; colIndex < sheet.columnCount; colIndex++) {
      const cell = sheet.getCell(rowIndex, colIndex);
      const value = cell.value;
      if (value !== null && value !== '') {
        rowHasValue = true;
        break;
      }
    }

    if (rowHasValue) {
      lastUsedRow = rowIndex + 1;
    }
  }

  return lastUsedRow === 0 ? 1 : lastUsedRow + 2;
}

function escribirBloque(sheet, startRow, startColumn, group, fechaStr) {
  const titleCell = sheet.getCell(startRow - 1, startColumn);
  titleCell.value = group.label;
  titleCell.textFormat = { bold: true };

  BLOCK_HEADERS.forEach((header, offset) => {
    const headerCell = sheet.getCell(startRow, startColumn + offset);
    headerCell.value = header;
    headerCell.textFormat = { bold: true };
  });

  group.turnos.forEach((turno, index) => {
    const rowIndex = startRow + 1 + index;
    sheet.getCell(rowIndex, startColumn).value = turno.hora || '';
    sheet.getCell(rowIndex, startColumn + 1).value = turno.cliente || '';
    sheet.getCell(rowIndex, startColumn + 2).value = turno.servicio || '';
    sheet.getCell(rowIndex, startColumn + 3).value = turno.estado || 'Pendiente';
    sheet.getCell(rowIndex, startColumn + 4).value = fechaStr;
  });
}

async function guardarTurnosAgenda(userId, turnos) {
  const agendaSheet = await crearTabAgendaSiNoExiste(userId);
  if (!agendaSheet) {
    throw new Error('No se pudo acceder a la tab Agenda');
  }

  if (!Array.isArray(turnos) || turnos.length === 0) {
    throw new Error('No hay turnos para guardar');
  }

  const now = new Date();
  const fechaStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
  const groups = agruparTurnos(turnos);

  const requiredColumns = groups.length * BLOCK_WIDTH + Math.max(0, groups.length - 1) * BLOCK_SPACING;
  await asegurarTamanoSheet(agendaSheet, Math.max(requiredColumns, 30), Math.max(agendaSheet.rowCount, 300));

  const startRow1Based = await getNextStartRow(agendaSheet);
  const rowsNeeded = startRow1Based + Math.max(...groups.map(group => group.turnos.length + 2), 2);
  await asegurarTamanoSheet(agendaSheet, Math.max(requiredColumns, agendaSheet.columnCount), rowsNeeded + 2);

  const endColumnIndex = requiredColumns - 1;
  const endColumnLetter = indexToColumnLetter(endColumnIndex);
  const loadStartRow = Math.max(1, startRow1Based);
  const endRow = startRow1Based + Math.max(...groups.map(group => group.turnos.length + 1), 1);
  await agendaSheet.loadCells(`A${loadStartRow}:${endColumnLetter}${endRow}`);

  groups.forEach((group, groupIndex) => {
    const startColumn = groupIndex * (BLOCK_WIDTH + BLOCK_SPACING);
    escribirBloque(agendaSheet, startRow1Based, startColumn, group, fechaStr);
  });

  await agendaSheet.saveUpdatedCells();
  invalidateCache(userId);

  const labels = groups.map(group => group.label);

  return {
    guardados: turnos.length,
    errores: 0,
    total: turnos.length,
    fechaStr,
    grupos: labels,
  };
}

module.exports = {
  crearTabAgendaSiNoExiste,
  guardarTurnosAgenda,
  guardarTurnosFlat,
  obtenerTurnosPorFecha,
  actualizarEstadoTurno,
  actualizarDatosTurno,
  fechaHoyStr,
};
