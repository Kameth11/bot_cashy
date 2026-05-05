const state = require('../state');
const { formatMonto } = require('../utils/formatter');

function generarIDUnico() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `mov_${timestamp}_${random}`;
}

function convertirAPesos(monto, moneda) {
  if (moneda === 'Dólares' && state.cotizacionDolar) {
    return Math.round(monto * state.cotizacionDolar * 100) / 100;
  }
  return monto;
}

function crearTimestampMovimiento(now = new Date()) {
  return {
    fechaStr: `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`,
    horaStr: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
  };
}

function calcularMontoPesos(monto, moneda, cotizacionUsada = state.cotizacionDolar) {
  if (moneda === 'Dólares' && cotizacionUsada) {
    return Math.round(Math.abs(monto) * cotizacionUsada * 100) / 100;
  }

  return convertirAPesos(monto, moneda);
}

function construirRowData({ fechaStr, horaStr, descripcion, monto, tipo, moneda, metodoPago, idUnico, montoPesos, idOrigen, estado = 'Cobrado' }) {
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
    'ID_Origen': idOrigen
  };
}

function crearMensajeMovimientoRegistrado({ tipo, descripcion, monto, moneda, metodoPago, fechaStr, idUnico, cotizacionUsada = null, montoPesos = null, estado = 'Cobrado' }) {
  const tipoTexto = tipo === 'Ingreso' ? 'Ingreso' : 'Gasto';
  const tipoEmoji = tipo === 'Ingreso' ? '💰' : '💸';
  const estadoFinal = estado || 'Cobrado';
  const titulo = estadoFinal === 'Pendiente' ? 'pendiente registrado' : `${tipoTexto.toLowerCase()} registrado`;

  let montoTexto = formatMonto(monto, moneda);
  if (moneda === 'Dólares' && cotizacionUsada) {
    montoTexto = `U$${Math.abs(monto).toLocaleString()} (cotización: $${cotizacionUsada.toLocaleString()})`;
    if (montoPesos !== null) {
      montoTexto += `\n💵 En pesos: $${montoPesos.toLocaleString()}`;
    }
  }

  return (
    `${tipoEmoji} *¡${titulo.charAt(0).toUpperCase() + titulo.slice(1)}!*\n\n` +
    `📝 Descripción: ${descripcion}\n` +
    `💰 Monto: ${montoTexto}\n` +
    `📊 Estado: ${estadoFinal}\n` +
    (metodoPago ? `💳 Método: ${metodoPago}\n` : '') +
    `📅 Fecha: ${fechaStr}\n` +
    `🆔 ID: \`${idUnico}\``
  );
}

module.exports = {
  generarIDUnico,
  convertirAPesos,
  crearTimestampMovimiento,
  calcularMontoPesos,
  construirRowData,
  crearMensajeMovimientoRegistrado,
};
