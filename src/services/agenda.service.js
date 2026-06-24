const { getDocCliente, invalidateCache } = require('./sheet.service');
const { CONSULTORIO_MAP } = require('../config');
const { runInBackground } = require('../lib/write-queue');

// Normaliza variantes como "Consultorio N° 1", "Consultorio Nro. 1",
// "CONSULTORIO #1" a la forma "consultorio 1" que usa CONSULTORIO_MAP.
// Sin esto, Gemini puede leer el "N°" de la imagen y romper el match exacto.
function normalizarConsultorioKey(value) {
  if (!value) return '';
  let key = String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const match = key.match(/consultorio[^0-9]*([0-9]+)/);
  if (match) return `consultorio ${match[1]}`;
  return key;
}

// El profesional siempre se determina por CONSULTORIO_MAP, nunca por el
// nombre que Gemini haya podido leer junto a un "Dr."/"Dra." en la imagen.
function resolverProfesional(profesional, consultorio) {
  if (consultorio) {
    const key = normalizarConsultorioKey(consultorio);
    if (Object.prototype.hasOwnProperty.call(CONSULTORIO_MAP, key)) {
      return CONSULTORIO_MAP[key];
    }
  }
  if (profesional) {
    const key = normalizarConsultorioKey(profesional);
    if (Object.prototype.hasOwnProperty.call(CONSULTORIO_MAP, key)) {
      return CONSULTORIO_MAP[key];
    }
  }
  return '';
}

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
    let sheet = doc.sheetsByTitle['Turnos'];
    if (sheet) {
      // sheet.headerValues es un getter que TIRA si el header no está
      // cargado (no devuelve undefined) -> hay que probarlo dentro del try.
      let headerValues = null;
      try {
        await sheet.loadHeaderRow();
        headerValues = sheet.headerValues;
      } catch (_) {
        // Tab existente sin header row (ej: quedó a medio crear) -> la rearmamos
        headerValues = null;
      }
      if (!Array.isArray(headerValues) || headerValues.length === 0) {
        await sheet.setHeaderRow(TURNOS_COLS);
        await sheet.loadHeaderRow();
      }
      return sheet;
    }
    console.log('Creando tab Turnos...');
    sheet = await doc.addSheet({ title: 'Turnos' });
    await sheet.setHeaderRow(TURNOS_COLS);
    await sheet.loadHeaderRow();
    console.log('Tab Turnos creada OK');
    return sheet;
  } catch (err) {
    console.error('Error al crear tab Turnos:', err.message);
    throw new Error(`No se pudo acceder a la tab Turnos: ${err.message}`);
  }
}

async function guardarTurnosFlat(userId, turnos) {
  const sheet = await crearTabTurnosSiNoExiste(userId);
  if (!sheet) throw new Error('No se pudo acceder a la tab Turnos');

  const fecha = fechaHoyStr();
  const ids = [];
  console.log(`Guardando ${turnos.length} turnos en tab Turnos (${fecha})...`);

  // Agrupar por consultorio para que el Sheet quede ordenado por sección
  const turnosOrdenados = [...turnos].sort((a, b) => {
    const ca = String(a.consultorio || a.profesional || '').toLowerCase();
    const cb = String(b.consultorio || b.profesional || '').toLowerCase();
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    return (a.hora || '').localeCompare(b.hora || '');
  });

  const filas = turnosOrdenados.map(turno => {
    const idTurno = generarIDTurno();
    ids.push(idTurno);
    return {
      ID_Turno: idTurno,
      Fecha: fecha,
      Hora: turno.hora || '',
      Cliente: turno.cliente || '',
      Servicio: turno.servicio || '',
      Profesional: resolverProfesional(turno.profesional, turno.consultorio),
      Consultorio: turno.consultorio || '',
      Estado: 'Pendiente',
    };
  });

  // Una sola llamada en lote en vez de un addRow por turno: evita pegarle
  // muchas requests seguidas a la API de Sheets (rate limit) con agendas grandes.
  await sheet.addRows(filas);

  return ids;
}

function rowToTurno(r) {
  return {
    idTurno: r.get('ID_Turno'),
    fecha: r.get('Fecha'),
    hora: r.get('Hora'),
    cliente: r.get('Cliente'),
    servicio: r.get('Servicio'),
    profesional: r.get('Profesional'),
    consultorio: r.get('Consultorio'),
    estado: r.get('Estado'),
  };
}

async function obtenerTurnosPorFecha(userId, fechaStr) {
  const sheet = await crearTabTurnosSiNoExiste(userId);
  if (!sheet) return [];
  const rows = await sheet.getRows();
  return rows
    .filter(r => r.get('Fecha') === fechaStr)
    .map(rowToTurno);
}

async function obtenerTurnoPorId(userId, idTurno) {
  const sheet = await crearTabTurnosSiNoExiste(userId);
  if (!sheet) return null;
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('ID_Turno') === idTurno);
  return row ? rowToTurno(row) : null;
}

async function actualizarEstadoTurno(userId, idTurno, nuevoEstado) {
  const sheet = await crearTabTurnosSiNoExiste(userId);
  if (!sheet) throw new Error('No se pudo acceder a la tab Turnos');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('ID_Turno') === idTurno);
  if (!row) throw new Error(`Turno ${idTurno} no encontrado`);
  row.set('Estado', nuevoEstado);
  await row.save();
  sincronizarAgenda(userId, row.get('Fecha'));
}

async function eliminarTurno(userId, idTurno) {
  const sheet = await crearTabTurnosSiNoExiste(userId);
  if (!sheet) throw new Error('No se pudo acceder a la tab Turnos');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('ID_Turno') === idTurno);
  if (!row) throw new Error('turno_no_encontrado');
  const fecha = row.get('Fecha');
  await row.delete();
  sincronizarAgenda(userId, fecha);
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
  sincronizarAgenda(userId, row.get('Fecha'));
}

const BLOCK_WIDTH = 5;
const BLOCK_SPACING = 1;
const BLOCK_HEADERS = ['Hora', 'Cliente', 'Servicio', 'Estado', 'Fecha'];


function getBlockLabel(turno) {
  const consultorio = turno.consultorio ? String(turno.consultorio).trim() : '';
  const profesional = resolverProfesional(turno.profesional, turno.consultorio);

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

  // Ensure generous size upfront so loadCells cubre todo el rango de escritura
  await asegurarTamanoSheet(agendaSheet, Math.max(agendaSheet.columnCount, 60), Math.max(agendaSheet.rowCount, 500));
  await agendaSheet.loadCells();

  // Buscar sección existente para esta fecha.
  // fechaStr se escribe en la columna (blockStartCol + 4) de cada fila de datos,
  // y los bloques están separados cada BLOCK_WIDTH + BLOCK_SPACING = 6 columnas.
  let minDataRow = Infinity;
  let maxColUsed = -1;

  for (let r = 0; r < agendaSheet.rowCount; r++) {
    for (let c = BLOCK_HEADERS.length - 1; c < agendaSheet.columnCount; c += BLOCK_WIDTH + BLOCK_SPACING) {
      if (agendaSheet.getCell(r, c).value === fechaStr) {
        if (r < minDataRow) minDataRow = r;
        if (c > maxColUsed) maxColUsed = c;
      }
    }
  }

  let startRow, startColumnOffset;
  if (minDataRow !== Infinity) {
    // Ya existe una sección para esta fecha: agregar bloques a la derecha
    startRow = minDataRow - 1;
    startColumnOffset = maxColUsed + 1 + BLOCK_SPACING;
  } else {
    // Fecha nueva: buscar la primera fila libre debajo del contenido existente
    let lastUsedRow = 0;
    for (let r = 0; r < agendaSheet.rowCount; r++) {
      for (let c = 0; c < agendaSheet.columnCount; c++) {
        const v = agendaSheet.getCell(r, c).value;
        if (v !== null && v !== '') { lastUsedRow = r + 1; break; }
      }
    }
    startRow = lastUsedRow === 0 ? 1 : lastUsedRow + 2;
    startColumnOffset = 0;
  }

  groups.forEach((group, groupIndex) => {
    const startColumn = startColumnOffset + groupIndex * (BLOCK_WIDTH + BLOCK_SPACING);
    escribirBloque(agendaSheet, startRow, startColumn, group, fechaStr);
  });

  await agendaSheet.saveUpdatedCells();
  invalidateCache(userId);

  return {
    guardados: turnos.length,
    errores: 0,
    total: turnos.length,
    fechaStr,
    grupos: groups.map(g => g.label),
  };
}

// Reescribe la sección visual de la tab "Agenda" para una fecha, tomando los
// turnos desde la tab "Turnos" (la fuente de verdad que usa el dashboard). La
// Agenda es solo una vista linda; nadie la lee de vuelta. Sin esto, queda
// congelada con lo que se importó de la foto mientras Turnos sigue cambiando
// (Llegó/Cobrado/editar/borrar), y las dos hojas se ven distintas.
async function escribirSeccionAgenda(userId, fechaStr, turnos) {
  const agendaSheet = await crearTabAgendaSiNoExiste(userId);
  if (!agendaSheet) throw new Error('No se pudo acceder a la tab Agenda');

  await asegurarTamanoSheet(agendaSheet, Math.max(agendaSheet.columnCount, 60), Math.max(agendaSheet.rowCount, 500));
  await agendaSheet.loadCells();
  renderizarSeccionFecha(agendaSheet, fechaStr, turnos);
  await agendaSheet.saveUpdatedCells();
  invalidateCache(userId);
}

// Parte pura (sin I/O) de la sincronización: sobre una grilla ya cargada,
// limpia la sección de `fechaStr` si existe y reescribe sus bloques desde
// `turnos`. Se exporta para poder testear el cálculo de celdas, que es donde
// es fácil equivocarse en silencio.
function renderizarSeccionFecha(sheet, fechaStr, turnos) {
  // 1. Localizar la sección existente para esta fecha: filas donde aparece
  //    fechaStr en la columna Fecha de algún bloque (cada bloque ocupa
  //    BLOCK_WIDTH+BLOCK_SPACING columnas; la Fecha está en el offset 4).
  let minDataRow = Infinity;
  let maxDataRow = -1;
  for (let r = 0; r < sheet.rowCount; r++) {
    for (let c = BLOCK_HEADERS.length - 1; c < sheet.columnCount; c += BLOCK_WIDTH + BLOCK_SPACING) {
      if (sheet.getCell(r, c).value === fechaStr) {
        if (r < minDataRow) minDataRow = r;
        if (r > maxDataRow) maxDataRow = r;
      }
    }
  }

  let startRow;
  if (minDataRow !== Infinity) {
    // Ya existe: limpiar toda la banda de filas de la sección (título 2 filas
    // arriba del primer dato, headers, y datos) en todas las columnas, para
    // reescribirla desde cero en el mismo lugar. El margen cubre el caso de
    // que un bloque crezca al reagrupar (los turnos para una fecha nunca
    // aumentan en estas operaciones, así que no pisa la fecha de abajo).
    const titleRow = Math.max(0, minDataRow - 2);
    const lastRow = Math.min(sheet.rowCount - 1, Math.max(maxDataRow, minDataRow + turnos.length) + 1);
    for (let r = titleRow; r <= lastRow; r++) {
      for (let c = 0; c < sheet.columnCount; c++) {
        const cell = sheet.getCell(r, c);
        if (cell.value !== null && cell.value !== '') cell.value = '';
      }
    }
    startRow = minDataRow - 1;
  } else {
    // Fecha nueva: primera fila libre debajo del contenido existente.
    let lastUsedRow = 0;
    for (let r = 0; r < sheet.rowCount; r++) {
      for (let c = 0; c < sheet.columnCount; c++) {
        const v = sheet.getCell(r, c).value;
        if (v !== null && v !== '') { lastUsedRow = r + 1; break; }
      }
    }
    startRow = lastUsedRow === 0 ? 1 : lastUsedRow + 2;
  }

  // 2. Escribir los bloques desde la columna 0 (si quedaron turnos; si se
  //    borraron todos, la sección queda limpia y no se escribe nada).
  if (turnos.length > 0) {
    const groups = agruparTurnos(turnos);
    groups.forEach((group, groupIndex) => {
      const startColumn = groupIndex * (BLOCK_WIDTH + BLOCK_SPACING);
      escribirBloque(sheet, startRow, startColumn, group, fechaStr);
    });
  }
}

// Dispara la sincronización de la Agenda para una fecha en background y
// best-effort: la Agenda es secundaria, no debe demorar ni romper la operación
// principal sobre Turnos. Corre bajo el lock del usuario para no pisar otras
// escrituras del mismo sheet.
function sincronizarAgenda(userId, fechaStr) {
  if (!fechaStr) return;
  runInBackground(userId, async () => {
    const turnos = await obtenerTurnosPorFecha(userId, fechaStr);
    await escribirSeccionAgenda(userId, fechaStr, turnos);
  }, 'agenda-sync');
}

module.exports = {
  crearTabAgendaSiNoExiste,
  guardarTurnosAgenda,
  guardarTurnosFlat,
  obtenerTurnosPorFecha,
  obtenerTurnoPorId,
  actualizarEstadoTurno,
  actualizarDatosTurno,
  eliminarTurno,
  escribirSeccionAgenda,
  renderizarSeccionFecha,
  sincronizarAgenda,
  fechaHoyStr,
  resolverProfesional,
};
