const { getDocCliente, invalidateCache } = require('./sheet.service');
const { CONSULTORIO_MAP } = require('../config');
const { runInBackground } = require('../lib/write-queue');
const { fechaArgentinaStr } = require('../utils/date');
const { resolveTenantId } = require('./tenant.service');
const { listarConsultoriosAsignados } = require('./profesional.service');

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

// El profesional siempre se determina por un mapa consultorio -> nombre,
// nunca por el nombre que Gemini haya podido leer junto a un "Dr."/"Dra."
// en la imagen. `mapa` es el mapeo del TENANT (ver obtenerConsultorioMap);
// si no se pasa ninguno, usa CONSULTORIO_MAP (compatibilidad hacia atrás
// para el único caller que no lo resuelve de forma async, y para tests).
function resolverProfesional(profesional, consultorio, mapa = CONSULTORIO_MAP) {
  if (consultorio) {
    const key = normalizarConsultorioKey(consultorio);
    if (Object.prototype.hasOwnProperty.call(mapa, key)) {
      return mapa[key];
    }
  }
  if (profesional) {
    const key = normalizarConsultorioKey(profesional);
    if (Object.prototype.hasOwnProperty.call(mapa, key)) {
      return mapa[key];
    }
    // Si el campo ya contiene el nombre directamente (ej: "Diego"), devolverlo
    const nameLower = profesional.trim().toLowerCase();
    for (const nombre of Object.values(mapa)) {
      if (nombre && nombre.toLowerCase() === nameLower) return nombre;
    }
  }
  return '';
}

// Cache en memoria de proceso, mismo patrón que tenantIdCache en
// tenant.service.js: evita pegarle a Supabase en cada turno de cada foto.
const CONSULTORIO_MAP_TTL_MS = 10 * 60 * 1000;
const consultorioMapCache = new Map();

// Mapa consultorio -> profesional para un tenant: lo que cada profesional
// declaró al hacer /profesional (columna `consultorio`, ver migración
// 010_profesionales_consultorio.sql). Si el tenant no tiene Supabase, no se
// pudo resolver, o todavía nadie cargó su consultorio, cae a CONSULTORIO_MAP
// (compatibilidad con el tenant existente / deploys sin Supabase).
async function obtenerConsultorioMap(tenantId) {
  if (!tenantId) return CONSULTORIO_MAP;

  const cached = consultorioMapCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const filas = await listarConsultoriosAsignados(tenantId);
  let mapa = CONSULTORIO_MAP;
  if (filas.length > 0) {
    mapa = {};
    for (const fila of filas) {
      const key = normalizarConsultorioKey(fila.consultorio);
      if (key) mapa[key] = fila.nombre || '';
    }
  }

  consultorioMapCache.set(tenantId, { value: mapa, expiresAt: Date.now() + CONSULTORIO_MAP_TTL_MS });
  return mapa;
}

// ── Tab "Turnos" — estructura plana, consultable por fecha ──

const TURNOS_COLS = ['ID_Turno', 'Fecha', 'Hora', 'Cliente', 'Servicio', 'Profesional', 'Consultorio', 'Estado'];

function generarIDTurno() {
  return `turno_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

function fechaHoyStr() {
  return fechaArgentinaStr();
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

// Versión liviana para operaciones sobre filas existentes: usa el doc cacheado
// sin forzar loadInfo() en cada llamada. Evita 429 de quota de lecturas.
async function getTurnosSheet(userId) {
  const doc = await getDocCliente(userId, false);
  if (!doc) return null;
  const sheet = doc.sheetsByTitle['Turnos'];
  if (!sheet) {
    // Tab todavía no existe (primer uso) — la creamos con el path completo
    return crearTabTurnosSiNoExiste(userId);
  }
  return sheet;
}

async function guardarTurnosFlat(userId, turnos, fecha = fechaHoyStr(), idsAEliminar = []) {
  const sheet = await crearTabTurnosSiNoExiste(userId);
  if (!sheet) throw new Error('No se pudo acceder a la tab Turnos');

  const mapaConsultorios = await obtenerConsultorioMap(await resolveTenantId(userId));

  if (idsAEliminar.length > 0) {
    const rows = await sheet.getRows();
    const aBorrar = rows.filter(r => idsAEliminar.includes(r.get('ID_Turno')));
    for (const row of aBorrar) {
      await row.delete();
    }
  }

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
      Profesional: resolverProfesional(turno.profesional, turno.consultorio, mapaConsultorios),
      Consultorio: turno.consultorio || '',
      Estado: turno.estado || 'Pendiente',
    };
  });

  // Una sola llamada en lote en vez de un addRow por turno: evita pegarle
  // muchas requests seguidas a la API de Sheets (rate limit) con agendas grandes.
  await sheet.addRows(filas);

  return ids;
}

// Clave de comparación para detectar duplicados: hora + nombre de paciente
// normalizado (sin acentos/mayúsculas). Si falta hora o cliente en alguno de
// los dos lados, no se considera match (evita falsos positivos entre turnos
// incompletos).
function normalizarNombreClave(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function claveTurno(turno) {
  const hora = String(turno.hora || '').trim();
  const cliente = normalizarNombreClave(turno.cliente);
  if (!hora || !cliente) return null;
  return `${hora}|${cliente}`;
}

// Compara los turnos a importar contra los ya guardados en "Turnos" para esa
// fecha (misma hora + paciente normalizado). Devuelve, por cada turno nuevo
// que matchea, el turno existente correspondiente (con su ID_Turno, para
// poder borrarlo si el usuario elige reemplazar).
async function detectarDuplicados(userId, turnos, fecha) {
  const existentes = await obtenerTurnosPorFecha(userId, fecha);
  const porClave = new Map();
  existentes.forEach(ex => {
    const clave = claveTurno(ex);
    if (clave) porClave.set(clave, ex);
  });

  const duplicados = [];
  turnos.forEach((turno, index) => {
    const clave = claveTurno(turno);
    if (clave && porClave.has(clave)) {
      duplicados.push({ nuevoIndex: index, existente: porClave.get(clave) });
    }
  });
  return duplicados;
}

// Guarda un lote de turnos (de una foto de agenda) para una fecha elegida por
// el usuario, y regenera la sección visual de "Agenda" para esa fecha a partir
// de "Turnos" (fuente de verdad), para que ambas pestañas queden consistentes
// aunque haya habido reemplazos de duplicados.
async function guardarAgendaParaFecha(userId, turnos, fecha, { idsAEliminar = [] } = {}) {
  await guardarTurnosFlat(userId, turnos, fecha, idsAEliminar);
  const turnosFinales = await obtenerTurnosPorFecha(userId, fecha);
  await escribirSeccionAgenda(userId, fecha, turnosFinales);
  return { guardados: turnos.length, total: turnos.length, fechaStr: fecha };
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
  const sheet = await getTurnosSheet(userId);
  if (!sheet) return [];
  const rows = await sheet.getRows();
  const del_dia = rows.filter(r => r.get('Fecha') === fechaStr);

  // Filas agregadas a mano en el Sheet sin ID_Turno: asignarles uno ahora
  // para que las acciones del dashboard (Llegó, Cobrar, etc.) funcionen.
  const sinId = del_dia.filter(r => !r.get('ID_Turno'));
  if (sinId.length > 0) {
    await Promise.all(sinId.map(row => {
      row.set('ID_Turno', generarIDTurno());
      return row.save();
    }));
  }

  return del_dia.map(rowToTurno);
}

async function crearTurno(userId, datos) {
  const sheet = await crearTabTurnosSiNoExiste(userId);
  if (!sheet) throw new Error('No se pudo acceder a la tab Turnos');
  const idTurno = generarIDTurno();
  const fecha = datos.fecha || fechaHoyStr();
  const mapaConsultorios = await obtenerConsultorioMap(await resolveTenantId(userId));
  const profesionalResuelto = resolverProfesional(datos.profesional, null, mapaConsultorios) || datos.profesional || '';
  await sheet.addRow({
    ID_Turno: idTurno,
    Fecha: fecha,
    Hora: datos.hora || '',
    Cliente: datos.cliente || '',
    Servicio: datos.servicio || '',
    Profesional: profesionalResuelto,
    Consultorio: '',
    Estado: 'Pendiente',
  });
  invalidateCache(userId);
  sincronizarAgenda(userId, fecha);
  return idTurno;
}

async function obtenerTurnoPorId(userId, idTurno) {
  const sheet = await getTurnosSheet(userId);
  if (!sheet) return null;
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('ID_Turno') === idTurno);
  return row ? rowToTurno(row) : null;
}

async function actualizarEstadoTurno(userId, idTurno, nuevoEstado) {
  const sheet = await getTurnosSheet(userId);
  if (!sheet) throw new Error('No se pudo acceder a la tab Turnos');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('ID_Turno') === idTurno);
  if (!row) throw new Error(`Turno ${idTurno} no encontrado`);
  row.set('Estado', nuevoEstado);
  await row.save();
  invalidateCache(userId);
  const fecha = row.get('Fecha');
  const turnosActualizados = rows.filter(r => r.get('Fecha') === fecha).map(rowToTurno);
  sincronizarAgendaConTurnos(userId, fecha, turnosActualizados);
}

async function eliminarTurno(userId, idTurno) {
  const sheet = await getTurnosSheet(userId);
  if (!sheet) throw new Error('No se pudo acceder a la tab Turnos');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('ID_Turno') === idTurno);
  if (!row) throw new Error('turno_no_encontrado');
  const fecha = row.get('Fecha');
  await row.delete();
  invalidateCache(userId);
  const turnosRestantes = rows
    .filter(r => r.get('ID_Turno') !== idTurno && r.get('Fecha') === fecha)
    .map(rowToTurno);
  sincronizarAgendaConTurnos(userId, fecha, turnosRestantes);
}

async function actualizarDatosTurno(userId, idTurno, datos) {
  const sheet = await getTurnosSheet(userId);
  if (!sheet) throw new Error('No se pudo acceder a la tab Turnos');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('ID_Turno') === idTurno);
  if (!row) throw new Error('turno_no_encontrado');
  const campos = { Cliente: datos.cliente, Servicio: datos.servicio, Profesional: datos.profesional, Hora: datos.hora };
  for (const [col, val] of Object.entries(campos)) {
    if (val !== undefined) row.set(col, val);
  }
  await row.save();
  invalidateCache(userId);
  const fecha = row.get('Fecha');
  const turnosActualizados = rows.filter(r => r.get('Fecha') === fecha).map(rowToTurno);
  sincronizarAgendaConTurnos(userId, fecha, turnosActualizados);
}

const BLOCK_WIDTH = 5;
const BLOCK_SPACING = 1;
const BLOCK_HEADERS = ['Hora', 'Cliente', 'Servicio', 'Estado', 'Fecha'];


function getBlockLabel(turno, mapa = CONSULTORIO_MAP) {
  const consultorio = turno.consultorio ? String(turno.consultorio).trim() : '';
  const profesional = resolverProfesional(turno.profesional, turno.consultorio, mapa);

  if (consultorio && profesional) return `${consultorio} - ${profesional}`;
  if (consultorio) return consultorio;
  if (profesional) return profesional;
  return 'A confirmar';
}

function agruparTurnos(turnos, mapa = CONSULTORIO_MAP) {
  const groups = [];
  const byLabel = new Map();

  for (const turno of turnos) {
    const label = getBlockLabel(turno, mapa);

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

// Reescribe la sección visual de la tab "Agenda" para una fecha, tomando los
// turnos desde la tab "Turnos" (la fuente de verdad que usa el dashboard). La
// Agenda es solo una vista linda; nadie la lee de vuelta. Sin esto, queda
// congelada con lo que se importó de la foto mientras Turnos sigue cambiando
// (Llegó/Cobrado/editar/borrar), y las dos hojas se ven distintas.
async function escribirSeccionAgenda(userId, fechaStr, turnos) {
  const agendaSheet = await crearTabAgendaSiNoExiste(userId);
  if (!agendaSheet) throw new Error('No se pudo acceder a la tab Agenda');

  const mapaConsultorios = await obtenerConsultorioMap(await resolveTenantId(userId));

  await asegurarTamanoSheet(agendaSheet, Math.max(agendaSheet.columnCount, 60), Math.max(agendaSheet.rowCount, 500));
  await agendaSheet.loadCells();
  renderizarSeccionFecha(agendaSheet, fechaStr, turnos, mapaConsultorios);
  await agendaSheet.saveUpdatedCells();
  invalidateCache(userId);
}

// Parte pura (sin I/O) de la sincronización: sobre una grilla ya cargada,
// limpia la sección de `fechaStr` si existe y reescribe sus bloques desde
// `turnos`. Se exporta para poder testear el cálculo de celdas, que es donde
// es fácil equivocarse en silencio. `mapa` es el consultorio->profesional
// del tenant (default CONSULTORIO_MAP para compatibilidad de los tests
// existentes, que no pasan ninguno).
function renderizarSeccionFecha(sheet, fechaStr, turnos, mapa = CONSULTORIO_MAP) {
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
    const groups = agruparTurnos(turnos, mapa);
    groups.forEach((group, groupIndex) => {
      const startColumn = groupIndex * (BLOCK_WIDTH + BLOCK_SPACING);
      escribirBloque(sheet, startRow, startColumn, group, fechaStr);
    });
  }
}

// Sincroniza la tab Agenda reutilizando turnos ya cargados en memoria: evita
// una segunda llamada a sheet.getRows() cuando la operación principal ya leyó
// el sheet (reduce reads y evita el 429 de la Sheets API).
function sincronizarAgendaConTurnos(userId, fechaStr, turnos) {
  if (!fechaStr) return;
  runInBackground(userId, async () => {
    await escribirSeccionAgenda(userId, fechaStr, turnos);
  }, 'agenda-sync');
}

// Versión completa: re-lee el sheet. Usar solo cuando no tenemos los turnos
// en memoria (ej: crearTurno, sincronización iniciada desde el bot).
function sincronizarAgenda(userId, fechaStr) {
  if (!fechaStr) return;
  runInBackground(userId, async () => {
    const turnos = await obtenerTurnosPorFecha(userId, fechaStr);
    await escribirSeccionAgenda(userId, fechaStr, turnos);
  }, 'agenda-sync');
}

module.exports = {
  crearTabAgendaSiNoExiste,
  guardarTurnosFlat,
  guardarAgendaParaFecha,
  detectarDuplicados,
  crearTurno,
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
  obtenerConsultorioMap,
};
