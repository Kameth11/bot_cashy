function normalizeValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

function toPositiveNumber(value, fallback = 0) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? Math.abs(parsed) : fallback;
}

function roundCurrency(value) {
  return Math.round(toPositiveNumber(value, 0) * 100) / 100;
}

function normalizeCategoria(categoria, fallback = null) {
  const normalized = normalizeValue(categoria);
  if (!normalized) return fallback;

  if (ALL_CATEGORIES.has(normalized)) {
    return normalized;
  }

  return fallback;
}

function normalizeMetodoPago(metodoPago) {
  const normalized = normalizeValue(metodoPago);
  if (!normalized) return null;

  if (['efectivo', 'transferencia', 'tarjeta', 'obra_social', 'otro'].includes(normalized)) {
    return normalized;
  }

  if (normalized === 'obra_sociales') return 'obra_social';
  return null;
}

function legacyDateToIso(rawDate) {
  const match = String(rawDate || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function legacyDateTimeToIso(rawDate, rawHour) {
  const isoDate = legacyDateToIso(rawDate);
  if (!isoDate) return null;

  const hour = String(rawHour || '').trim();
  if (!hour) return `${isoDate}T00:00:00.000Z`;

  const match = hour.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return `${isoDate}T00:00:00.000Z`;

  const [, hh, mm] = match;
  return `${isoDate}T${hh.padStart(2, '0')}:${mm}:00.000Z`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getTipoMovimientoFromLegacy(tipo) {
  return normalizeValue(tipo) === 'egreso' ? 'egreso' : 'ingreso';
}

function getSaldoPendienteFromLegacy({ legacyEstado, monto }) {
  return normalizeValue(legacyEstado) === 'pendiente' ? roundCurrency(monto) : 0;
}

function mapLegacyStateToV2({ tipoMovimiento, legacyEstado, saldoPendiente, previousSaldoPendiente = null }) {
  const normalizedState = normalizeValue(legacyEstado);

  if (normalizedState === 'cancelado') return 'cancelado';
  if (normalizedState === 'vencido') return 'vencido';

  if (saldoPendiente > 0 && previousSaldoPendiente !== null && previousSaldoPendiente > saldoPendiente) {
    return 'parcial';
  }

  if (normalizedState === 'pendiente' && saldoPendiente > 0) {
    return 'pendiente';
  }

  return tipoMovimiento === 'egreso' ? 'pagado' : 'cobrado';
}

function inferirCategoriaMovimiento({ tipoMovimiento, categoria, descripcion = '', estadoPago = '' }) {
  const normalizedCategoria = normalizeCategoria(categoria);
  if (normalizedCategoria) return normalizedCategoria;

  const text = normalizeValue(descripcion).replace(/_/g, ' ');

  if (tipoMovimiento === 'egreso') {
    if (/sueld/.test(text)) return 'sueldos';
    if (/honorario/.test(text)) return 'honorarios';
    if (/insumo|guante|bracket|anestesia|material/.test(text)) return 'insumos';
    if (/alquiler/.test(text)) return 'alquiler';
    if (/expensa/.test(text)) return 'expensas';
    if (/luz|agua|internet|telefono|servicio/.test(text)) return 'servicios';
    if (/impuesto|iva|ingresos brutos|ganancia|monotributo/.test(text)) return 'impuestos';
    if (/mantenimiento|autoclave|rayos x|sillon|equipo|reparacion/.test(text)) return 'mantenimiento';
    if (/software|sistema|licencia|suscripcion/.test(text)) return 'software';
    return 'otro_egreso';
  }

  if (normalizeValue(estadoPago) === 'pendiente') return 'cobro_pendiente';
  if (/consulta/.test(text)) return 'consulta';
  if (/anticipo|adelanto/.test(text)) return 'anticipo';
  if (/sena|reserva/.test(text)) return 'sena';
  if (/cuota/.test(text)) return 'cuota';
  if (/saldo/.test(text)) return 'saldo_final';
  if (/tratamiento|servicio|implante|ortodoncia|endodoncia/.test(text)) return 'tratamiento';

  return 'tratamiento';
}

function buildMovimientoV2Payload({ userId, rowData, legacyId = null, metadata = {} }) {
  const tipoMovimiento = getTipoMovimientoFromLegacy(rowData.Tipo);
  const saldoPendiente = getSaldoPendienteFromLegacy({
    legacyEstado: rowData.Estado,
    monto: rowData.Monto,
  });
  const estadoPago = mapLegacyStateToV2({
    tipoMovimiento,
    legacyEstado: rowData.Estado,
    saldoPendiente,
    previousSaldoPendiente: null,
  });
  const categoria = inferirCategoriaMovimiento({
    tipoMovimiento,
    categoria: metadata.categoria,
    descripcion: rowData.Descripcion,
    estadoPago: rowData.Estado,
  });

  const montoOriginal = roundCurrency(rowData.Monto);
  const montoPesos = roundCurrency(rowData.MontoPesos || montoOriginal);
  const fechaPrestacion = metadata.fechaPrestacion || legacyDateToIso(rowData.Fecha);
  const fechaCobroReal = estadoPago === 'pendiente'
    ? (metadata.fechaCobroReal || null)
    : (metadata.fechaCobroReal || legacyDateToIso(rowData.Fecha));
  const fechaCarga = metadata.fechaCarga || legacyDateTimeToIso(rowData.Fecha, rowData.Hora) || new Date().toISOString();

  return {
    user_id: userId,
    tipo_movimiento: tipoMovimiento,
    categoria,
    subcategoria: metadata.subcategoria || null,
    estado_pago: estadoPago,
    descripcion: rowData.Descripcion || '',
    paciente_nombre: metadata.pacienteNombre || null,
    profesional_nombre: metadata.profesionalNombre || null,
    proveedor_nombre: metadata.proveedorNombre || null,
    tratamiento_nombre: metadata.tratamientoNombre || null,
    metodo_pago: normalizeMetodoPago(metadata.metodoPago || rowData.MetodoPago),
    moneda: rowData.Moneda || 'Pesos',
    monto_original: montoOriginal,
    monto_pesos: montoPesos,
    saldo_pendiente: saldoPendiente,
    fecha_prestacion: fechaPrestacion,
    fecha_cobro_real: fechaCobroReal,
    fecha_vencimiento: metadata.fechaVencimiento || null,
    fecha_carga: fechaCarga,
    origen_carga: metadata.origenCarga || 'bot',
    referencia_id: metadata.referenciaId || null,
    notas: metadata.notas || null,
    legacy_row_id: legacyId ? String(legacyId) : null,
  };
}

function buildMovimientoV2UpdatePayload({ legacyRow, updates = {}, currentV2, allowPartialState = false }) {
  const merged = {
    fecha: updates.fecha !== undefined ? updates.fecha : legacyRow.fecha,
    hora: updates.hora !== undefined ? updates.hora : legacyRow.hora,
    descripcion: updates.descripcion !== undefined ? updates.descripcion : legacyRow.descripcion,
    monto: updates.monto !== undefined ? updates.monto : legacyRow.monto,
    estado: updates.estado !== undefined ? updates.estado : legacyRow.estado,
    tipo: updates.tipo !== undefined ? updates.tipo : legacyRow.tipo,
    moneda: updates.moneda !== undefined ? updates.moneda : legacyRow.moneda,
    metodo_pago: updates.metodo_pago !== undefined ? updates.metodo_pago : legacyRow.metodo_pago,
    monto_pesos: updates.monto_pesos !== undefined ? updates.monto_pesos : legacyRow.monto_pesos,
  };

  const tipoMovimiento = getTipoMovimientoFromLegacy(merged.tipo || currentV2?.tipo_movimiento);
  const saldoPendiente = getSaldoPendienteFromLegacy({
    legacyEstado: merged.estado,
    monto: merged.monto,
  });
  const previousSaldoPendiente = currentV2 ? roundCurrency(currentV2.saldo_pendiente) : null;
  const statusDrivenUpdate = allowPartialState && updates.estado !== undefined;
  const saldoReduced = previousSaldoPendiente !== null && previousSaldoPendiente > saldoPendiente;
  const estadoPago = mapLegacyStateToV2({
    tipoMovimiento,
    legacyEstado: merged.estado,
    saldoPendiente,
    previousSaldoPendiente: allowPartialState ? previousSaldoPendiente : null,
  });
  let montoOriginal = currentV2 ? roundCurrency(currentV2.monto_original) : roundCurrency(merged.monto || 0);

  if (!statusDrivenUpdate && updates.monto !== undefined) {
    montoOriginal = roundCurrency(merged.monto || 0);
  }

  if (!currentV2) {
    montoOriginal = roundCurrency(merged.monto || 0);
  }

  let montoPesos = currentV2 ? roundCurrency(currentV2.monto_pesos) : roundCurrency(merged.monto_pesos || montoOriginal);
  if (!statusDrivenUpdate && updates.monto_pesos !== undefined) {
    montoPesos = roundCurrency(updates.monto_pesos);
  } else if (!statusDrivenUpdate && (merged.moneda || currentV2?.moneda) !== 'Dólares') {
    montoPesos = montoOriginal;
  } else if (!currentV2) {
    montoPesos = roundCurrency(merged.monto_pesos || montoOriginal);
  }

  let fechaCobroReal = currentV2?.fecha_cobro_real || null;
  if (saldoPendiente === 0 && previousSaldoPendiente !== 0) {
    fechaCobroReal = todayIsoDate();
  }
  if (saldoPendiente > 0 && statusDrivenUpdate && saldoReduced) {
    fechaCobroReal = null;
  }

  return {
    categoria: inferirCategoriaMovimiento({
      tipoMovimiento,
      categoria: currentV2?.categoria,
      descripcion: merged.descripcion,
      estadoPago: merged.estado,
    }),
    estado_pago: estadoPago,
    descripcion: merged.descripcion || currentV2?.descripcion || '',
    metodo_pago: normalizeMetodoPago(merged.metodo_pago) || currentV2?.metodo_pago || null,
    moneda: merged.moneda || currentV2?.moneda || 'Pesos',
    monto_original: montoOriginal,
    monto_pesos: montoPesos,
    saldo_pendiente: saldoPendiente,
    fecha_cobro_real: fechaCobroReal,
  };
}

function buildMovimientoV2CreationEvent({ movimientoId, userId, movimientoData }) {
  return {
    movimiento_id: movimientoId,
    user_id: userId,
    tipo_evento: 'creacion',
    estado_resultante: movimientoData.estado_pago,
    monto: roundCurrency(movimientoData.monto_original),
    monto_pesos: roundCurrency(movimientoData.monto_pesos),
    moneda: movimientoData.moneda || 'Pesos',
    metodo_pago: movimientoData.metodo_pago || null,
    fecha_evento: movimientoData.fecha_prestacion || todayIsoDate(),
    descripcion: 'Alta inicial del movimiento',
  };
}

function buildMovimientoV2TransitionEvent({ movimientoId, userId, previousV2, nextV2, metodoPago = null }) {
  const previousSaldo = roundCurrency(previousV2?.saldo_pendiente || 0);
  const nextSaldo = roundCurrency(nextV2?.saldo_pendiente || 0);

  if (previousSaldo <= nextSaldo) {
    return null;
  }

  const monto = roundCurrency(previousSaldo - nextSaldo);
  const factor = previousV2?.monto_original
    ? roundCurrency(previousV2.monto_pesos || 0) / roundCurrency(previousV2.monto_original || 1)
    : 1;
  const montoPesos = roundCurrency(monto * factor);
  const esTotal = nextSaldo === 0;
  const tipoEvento = previousV2.tipo_movimiento === 'egreso'
    ? (esTotal ? 'pago_total' : 'pago_parcial')
    : (esTotal ? 'cobro_total' : 'cobro_parcial');

  return {
    movimiento_id: movimientoId,
    user_id: userId,
    tipo_evento: tipoEvento,
    estado_resultante: nextV2.estado_pago,
    monto,
    monto_pesos: montoPesos,
    moneda: previousV2.moneda || 'Pesos',
    metodo_pago: normalizeMetodoPago(metodoPago) || previousV2.metodo_pago || null,
    fecha_evento: todayIsoDate(),
    descripcion: esTotal ? 'Cancelacion total del saldo' : 'Cancelacion parcial del saldo',
  };
}

const ALL_CATEGORIES = new Set([
  'consulta',
  'tratamiento',
  'anticipo',
  'sena',
  'cuota',
  'saldo_final',
  'cobro_pendiente',
  'otro_ingreso',
  'sueldos',
  'honorarios',
  'insumos',
  'alquiler',
  'expensas',
  'servicios',
  'impuestos',
  'mantenimiento',
  'software',
  'otro_egreso',
]);

module.exports = {
  buildMovimientoV2Payload,
  buildMovimientoV2UpdatePayload,
  buildMovimientoV2CreationEvent,
  buildMovimientoV2TransitionEvent,
  getTipoMovimientoFromLegacy,
  inferirCategoriaMovimiento,
  legacyDateToIso,
  mapLegacyStateToV2,
  normalizeCategoria,
  normalizeMetodoPago,
  roundCurrency,
};
