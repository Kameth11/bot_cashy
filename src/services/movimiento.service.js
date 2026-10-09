const state = require('../state');
const db = require('./db.service');
const { formatMonto, escapeMarkdown } = require('../utils/formatter');
const { obtenerClientePorUserId } = require('../auth');
const { fechaArgentinaStr, horaArgentinaStr } = require('../utils/date');

function generarIDUnico() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `mov_${timestamp}_${random}`;
}

function convertirAPesos(monto, moneda) {
  if (moneda === 'Dólares' && state.cotizacionDolar) {
    return Math.round(monto * state.cotizacionDolar * 100) / 100;
  }
  if (moneda === 'Euros' && state.cotizacionEuro) {
    return Math.round(monto * state.cotizacionEuro * 100) / 100;
  }
  return monto;
}

function crearTimestampMovimiento(now = new Date()) {
  return {
    fechaStr: fechaArgentinaStr(now),
    horaStr: horaArgentinaStr(now),
  };
}

function calcularMontoPesos(monto, moneda, cotizacionUsada = null) {
  if (moneda === 'Dólares') {
    const cot = cotizacionUsada || state.cotizacionDolar;
    if (cot) return Math.round(Math.abs(monto) * cot * 100) / 100;
  }
  if (moneda === 'Euros') {
    const cot = cotizacionUsada || state.cotizacionEuro;
    if (cot) return Math.round(Math.abs(monto) * cot * 100) / 100;
  }
  return convertirAPesos(monto, moneda);
}

function construirRowData({
  fechaStr,
  horaStr,
  descripcion,
  monto,
  tipo,
  moneda,
  metodoPago,
  idUnico,
  montoPesos,
  idOrigen,
  estado = 'Cobrado',
  categoria = '',
  paciente = '',
  pagador = '',
  profesional = '',
  tratamiento = '',
  proveedor = '',
  fechaPrestacion = '',
  fechaVencimiento = '',
  saldoPendiente = 0,
  referenciaId = '',
}) {
  return {
    'Fecha': fechaStr,
    'Hora': horaStr,
    'Descripcion': descripcion,
    'Monto': monto,
    'Estado': estado,
    'Tipo': tipo,
    'Moneda': moneda,
    'MetodoPago': metodoPago || '',
    'ID_Unico': idUnico,
    'MontoPesos': montoPesos,
    'ID_Origen': idOrigen,
    'Categoria': categoria || '',
    'Paciente': paciente || '',
    'Pagador': pagador || '',
    'Profesional': profesional || '',
    'Tratamiento': tratamiento || '',
    'Proveedor': proveedor || '',
    'FechaPrestacion': fechaPrestacion || '',
    'FechaVencimiento': fechaVencimiento || '',
    'SaldoPendiente': saldoPendiente,
    'ReferenciaId': referenciaId || '',
  };
}

function crearMensajeMovimientoRegistrado({ tipo, descripcion, monto, moneda, metodoPago, fechaStr, idUnico, cotizacionUsada = null, montoPesos = null, estado = 'Cobrado' }) {
  const tipoTexto = tipo === 'Ingreso' ? 'Ingreso' : 'Gasto';
  const tipoEmoji = tipo === 'Ingreso' ? '💰' : '💸';
  const estadoFinal = estado || 'Cobrado';
  const titulo = estadoFinal === 'Pendiente' ? 'pendiente registrado' : `${tipoTexto.toLowerCase()} registrado`;

  let montoTexto = formatMonto(monto, moneda);
  if (moneda === 'Dólares' && cotizacionUsada) {
    montoTexto = `U$${Math.abs(monto).toLocaleString('es-AR')} (cotización: $${cotizacionUsada.toLocaleString('es-AR')})`;
    if (montoPesos !== null) {
      montoTexto += `\n💵 En pesos: $${montoPesos.toLocaleString('es-AR')}`;
    }
  } else if (moneda === 'Euros' && cotizacionUsada) {
    montoTexto = `€${Math.abs(monto).toLocaleString('es-AR')} (cotización: $${cotizacionUsada.toLocaleString('es-AR')})`;
    if (montoPesos !== null) {
      montoTexto += `\n💶 En pesos: $${montoPesos.toLocaleString('es-AR')}`;
    }
  }

  return (
    `${tipoEmoji} *¡${titulo.charAt(0).toUpperCase() + titulo.slice(1)}!*\n\n` +
    `📝 Descripción: ${escapeMarkdown(descripcion)}\n` +
    `💰 Monto: ${montoTexto}\n` +
    `📊 Estado: ${estadoFinal}\n` +
    (metodoPago ? `💳 Método: ${metodoPago}\n` : '') +
    `📅 Fecha: ${fechaStr}\n` +
    `🆔 ID: \`${idUnico}\``
  );
}

function vincularComprobante(userId, idComprobante, idMovimiento) {
  const comprobanteService = require('./comprobante.service');
  const archivoService = require('./comprobante-archivo.service');
  comprobanteService.vincularMovimiento(userId, idComprobante, idMovimiento)
    .then(() => archivoService.vincularMovimientoEnSupabase(userId, idComprobante, idMovimiento))
    .catch(err => console.error('Comprobantes: no se pudo vincular el movimiento:', err.message));
}

async function guardarMovimiento(userId, {
  descripcion,
  monto,
  tipo,
  moneda,
  metodoPago,
  estado = 'Cobrado',
  montoPesos,
  now = new Date(),
  categoria = null,
  subcategoria = null,
  pacienteNombre = null,
  pagadorNombre = null,
  profesionalNombre = null,
  proveedorNombre = null,
  tratamientoNombre = null,
  fechaPrestacion = null,
  fechaCobroReal = null,
  fechaVencimiento = null,
  referenciaId = null,
  notas = null,
  origenCarga = 'bot',
}) {
  const { fechaStr, horaStr } = crearTimestampMovimiento(now);
  const cliente = obtenerClientePorUserId(userId);
  const idOrigen = cliente ? (cliente.email || cliente.telegramUserId || userId) : userId;
  const idUnico = generarIDUnico();
  const montoPesosFinal = montoPesos ?? calcularMontoPesos(monto, moneda);

  const rowData = construirRowData({
    fechaStr,
    horaStr,
    descripcion,
    monto,
    tipo,
    moneda,
    metodoPago,
    idUnico,
    montoPesos: montoPesosFinal,
    idOrigen,
    estado,
    categoria,
    paciente: pacienteNombre,
    pagador: pagadorNombre,
    profesional: profesionalNombre,
    tratamiento: tratamientoNombre,
      proveedor: proveedorNombre,
      fechaPrestacion: fechaPrestacion || fechaStr,
      fechaVencimiento,
      saldoPendiente: estado === 'Pendiente' ? Math.abs(monto) : 0,
      referenciaId,
  });

  const savedRow = await db.addRow(userId, rowData, {
    movimientoV2Data: {
      categoria,
      subcategoria,
      pacienteNombre,
      pagadorNombre,
      profesionalNombre,
      proveedorNombre,
      tratamientoNombre,
      fechaPrestacion,
      fechaCobroReal,
      fechaVencimiento,
      referenciaId,
      notas,
      origenCarga,
      metodoPago,
    },
  });
  if (!savedRow) {
    throw new Error('sheet_no_configurado');
  }

  // Movimiento que vino de una foto/PDF: se completa el vínculo en el
  // comprobante. Sin await: no puede demorar ni romper el guardado, y toma su
  // propio lock (que se libera cuando termina este guardado).
  if (typeof referenciaId === 'string' && referenciaId.startsWith('comp:')) {
    vincularComprobante(userId, referenciaId.slice(5), idUnico);
  }

  return {
    rowData,
    idUnico,
    fechaStr,
    horaStr,
    montoPesos: montoPesosFinal,
  };
}

// Vuelve a cargar un movimiento que se borró (deshacer): conserva el ID único y la
// fecha/hora originales para que quede exactamente como estaba. `mov` ya viene
// validado por quien llama (ver POST /api/movimientos/restaurar).
async function restaurarMovimiento(userId, mov) {
  const cliente = obtenerClientePorUserId(userId);
  const idOrigen = cliente ? (cliente.email || cliente.telegramUserId || userId) : userId;
  const rowData = construirRowData({
    fechaStr: mov.fecha,
    horaStr: mov.hora,
    descripcion: mov.descripcion,
    monto: mov.monto,
    tipo: mov.tipo,
    moneda: mov.moneda,
    metodoPago: mov.metodoPago,
    idUnico: mov.idUnico,
    montoPesos: mov.montoPesos,
    idOrigen,
    estado: mov.estado,
    categoria: mov.categoria,
    paciente: mov.paciente,
    pagador: mov.pagador,
    profesional: mov.profesional,
    tratamiento: mov.tratamiento,
    proveedor: mov.proveedor,
    fechaPrestacion: mov.fechaPrestacion,
    fechaVencimiento: mov.fechaVencimiento,
    saldoPendiente: mov.saldoPendiente,
    referenciaId: mov.referenciaId,
  });
  if (mov.fechaCobro) rowData.FechaCobro = mov.fechaCobro;

  const savedRow = await db.addRow(userId, rowData, {
    movimientoV2Data: {
      categoria: mov.categoria || null,
      pacienteNombre: mov.paciente || null,
      pagadorNombre: mov.pagador || null,
      profesionalNombre: mov.profesional || null,
      proveedorNombre: mov.proveedor || null,
      tratamientoNombre: mov.tratamiento || null,
      fechaPrestacion: mov.fechaPrestacion || null,
      fechaVencimiento: mov.fechaVencimiento || null,
      referenciaId: mov.referenciaId || null,
      origenCarga: 'deshacer',
      metodoPago: mov.metodoPago,
    },
  });
  if (!savedRow) throw new Error('sheet_no_configurado');
  return mov.idUnico;
}

module.exports = {
  restaurarMovimiento,
  generarIDUnico,
  convertirAPesos,
  crearTimestampMovimiento,
  calcularMontoPesos,
  construirRowData,
  crearMensajeMovimientoRegistrado,
  guardarMovimiento,
};
