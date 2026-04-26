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

function getRowDescripcion(row, fallback = 'Sin descripción') {
  return getField(row, ['Descripcion', 'descripcion', 'Paciente', 'paciente', 'Nombre', 'nombre'], fallback);
}

function getRowIdUnico(row, fallback = 'sin-id') {
  return getField(row, ['ID_Unico', 'ID_unico', 'ID_uNico', 'idunico'], fallback);
}

function getRowFecha(row, fallback = 'N/A') {
  return getField(row, ['Fecha', 'fecha'], fallback);
}

function getRowHora(row, fallback = 'N/A') {
  return getField(row, ['Hora', 'hora'], fallback);
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
  return getField(row, ['Estado', 'estado'], fallback);
}

function getRowTipo(row, fallback = '') {
  return getField(row, ['Tipo', 'tipo'], fallback);
}

function getRowMoneda(row, fallback = 'Pesos') {
  return getField(row, ['Moneda', 'moneda'], fallback);
}

function getRowMetodoPago(row, fallback = '') {
  return getField(row, ['MetodoPago', 'metodopago'], fallback);
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
  toMovimiento,
  isValidMovimientoRow,
};
