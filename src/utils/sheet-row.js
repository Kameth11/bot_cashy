function getRowObject(row) {
  if (!row) return {};
  return row.toObject ? row.toObject() : row;
}

function getField(source, keys, fallback = '') {
  if (!source) return fallback;

  for (const key of keys) {
    let value;

    if (typeof source.get === 'function') {
      value = source.get(key);
    } else {
      value = source[key];
    }

    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return fallback;
}

function normalizeValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function formatDateValue(value, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
  }

  const raw = String(value).trim();
  if (!raw) return fallback;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw || fallback;
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function formatHourValue(value, fallback = 'N/A') {
  if (value === undefined || value === null || value === '') return fallback;

  const raw = String(value).trim();
  if (!raw) return fallback;
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;

  const isoMatch = raw.match(/(?:T|\s)(\d{2}):(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}:${isoMatch[2]}`;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw || fallback;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function normalizeEstadoValue(value, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;

  const normalized = normalizeValue(value).replace(/\s+/g, '_');
  if (normalized === 'pendiente') return 'Pendiente';
  if (['cobrado', 'pagado'].includes(normalized)) return 'Cobrado';
  if (normalized === 'parcial') return 'Pendiente';
  if (normalized === 'rechazado') return 'Rechazado';
  if (normalized === 'presentado_os') return 'Presentado OS';
  return String(value).trim() || fallback;
}

function normalizeTipoValue(value, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;

  const normalized = normalizeValue(value);
  if (normalized === 'egreso') return 'Egreso';
  if (normalized === 'ingreso') return 'Ingreso';
  return String(value).trim() || fallback;
}

function getRowDescripcion(row, fallback = 'Sin descripción') {
  return getField(row, ['Descripcion', 'descripcion', 'Paciente', 'paciente', 'Nombre', 'nombre'], fallback);
}

function getRowIdUnico(row, fallback = 'sin-id') {
  return getField(row, ['ID_Unico', 'ID_unico', 'ID_uNico', 'idunico'], fallback);
}

function getRowFecha(row, fallback = 'N/A') {
  const value = getField(row, ['Fecha', 'fecha'], fallback);
  return formatDateValue(value, fallback);
}

function getRowHora(row, fallback = 'N/A') {
  const value = getField(row, ['Hora', 'hora'], fallback);
  return formatHourValue(value, fallback);
}

function getRowMonto(row, fallback = 0) {
  const value = getField(row, ['Monto', 'monto'], fallback);
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getRowMontoRaw(row, fallback = '0') {
  return getField(row, ['Monto', 'monto'], fallback);
}

function getRowMontoPesos(row, fallback) {
  const raw = getField(row, ['MontoPesos', 'montopesos', 'Monto', 'monto'], fallback ?? 0);
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) ? (fallback ?? 0) : parsed;
}

function getRowEstado(row, fallback = '') {
  const value = getField(row, ['Estado', 'estado'], fallback);
  return normalizeEstadoValue(value, fallback);
}

function getRowTipo(row, fallback = '') {
  const value = getField(row, ['Tipo', 'tipo'], fallback);
  return normalizeTipoValue(value, fallback);
}

function getRowMoneda(row, fallback = 'Pesos') {
  return getField(row, ['Moneda', 'moneda'], fallback);
}

function getRowMetodoPago(row, fallback = '') {
  return getField(row, ['MetodoPago', 'metodopago', 'MedioPago', 'medioPago', 'medio_pago', 'metodo_pago'], fallback);
}

function getRowCategoria(row, fallback = '') {
  return getField(row, ['Categoria', 'categoria'], fallback);
}

function getRowPaciente(row, fallback = '') {
  return getField(row, ['Paciente', 'paciente'], fallback);
}

function getRowPagador(row, fallback = '') {
  return getField(row, ['Pagador', 'pagador'], fallback);
}

function getRowProfesional(row, fallback = '') {
  return getField(row, ['Profesional', 'profesional'], fallback);
}

function getRowTratamiento(row, fallback = '') {
  return getField(row, ['Tratamiento', 'tratamiento'], fallback);
}

function getRowProveedor(row, fallback = '') {
  return getField(row, ['Proveedor', 'proveedor'], fallback);
}

function getRowFechaPrestacion(row, fallback = '') {
  const value = getField(row, ['FechaPrestacion', 'fechaprestacion'], fallback);
  return formatDateValue(value, fallback);
}

function getRowFechaVencimiento(row, fallback = '') {
  const value = getField(row, ['FechaVencimiento', 'fechavencimiento'], fallback);
  return formatDateValue(value, fallback);
}

function getRowSaldoPendiente(row, fallback = 0) {
  const raw = getField(row, ['SaldoPendiente', 'saldopendiente'], fallback);
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toMovimiento(row) {
  return {
    fecha: getRowFecha(row, ''),
    hora: getRowHora(row, ''),
    descripcion: getRowDescripcion(row, ''),
    monto: getRowMonto(row, 0),
    montoPesos: getRowMontoPesos(row, 0),
    estado: getRowEstado(row, ''),
    tipo: getRowTipo(row, ''),
    moneda: getRowMoneda(row, 'Pesos'),
    metodoPago: getRowMetodoPago(row, ''),
    idUnico: getRowIdUnico(row, ''),
    categoria: getRowCategoria(row, ''),
    paciente: getRowPaciente(row, ''),
    pagador: getRowPagador(row, ''),
    profesional: getRowProfesional(row, ''),
    tratamiento: getRowTratamiento(row, ''),
    proveedor: getRowProveedor(row, ''),
    fechaPrestacion: getRowFechaPrestacion(row, ''),
    fechaVencimiento: getRowFechaVencimiento(row, ''),
    saldoPendiente: getRowSaldoPendiente(row, 0),
  };
}

function isValidMovimientoRow(row) {
  const movimiento = toMovimiento(row);
  return Boolean(
    movimiento.fecha && movimiento.fecha.trim() !== '' &&
    movimiento.descripcion && movimiento.descripcion.trim() !== '' &&
    movimiento.monto && movimiento.monto !== 0
  );
}

module.exports = {
  getRowObject,
  getRowDescripcion,
  getRowIdUnico,
  getRowFecha,
  getRowHora,
  getRowMonto,
  getRowMontoRaw,
  getRowMontoPesos,
  getRowEstado,
  getRowTipo,
  getRowMoneda,
  getRowMetodoPago,
  getRowCategoria,
  getRowPaciente,
  getRowPagador,
  getRowProfesional,
  getRowTratamiento,
  getRowProveedor,
  getRowFechaPrestacion,
  getRowFechaVencimiento,
  getRowSaldoPendiente,
  formatDateValue,
  toMovimiento,
  isValidMovimientoRow,
};
