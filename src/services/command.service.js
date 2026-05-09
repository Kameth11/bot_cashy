const { obtenerDatosSheet, getSheetCliente, invalidateCache } = require('./sheet.service');
const db = require('./db.service');
const { aplicarColorMontoEnFila } = require('./sheet-format.service');

const { esHoy, esEstaSemana, esEsteMes, normalizarFecha } = require('../utils/date');
const { formatMonto, formatFecha } = require('../utils/formatter');
const { obtenerCotizacionDolar } = require('./cotizacion.service');
const {
  calcularMontoPesos,
  crearMensajeMovimientoRegistrado,
  guardarMovimiento: persistirMovimiento,
} = require('./movimiento.service');
const state = require('../state');
const {
  getRowEstado,
  getRowDescripcion,
  getRowIdUnico,
  getRowMonto,
  getRowMoneda,
  getRowFecha,
} = require('../utils/sheet-row');

async function construirMensajeCotizacion(monto) {
  if (!state.cotizacionDolar) {
    await obtenerCotizacionDolar();
  }

  const promedioActual = state.cotizacionDolar
    ? `Promedio actual: $${state.cotizacionDolar.toLocaleString('es-AR')}\n\n`
    : '';

  return (
    `💵 *Movimiento en dólares*\n\n` +
    `Monto: U$${Math.abs(monto).toLocaleString()}\n\n` +
    promedioActual +
    `Ingresá la cotización del dólar (ej: 1250):`
  );
}

async function ejecutarBalance(userId) {
  const datos = await obtenerDatosSheet(userId);

  const hoy = datos.filter(d => esHoy(d.fecha));
  const semana = datos.filter(d => esEstaSemana(d.fecha));
  const mes = datos.filter(d => esEsteMes(d.fecha));

  const totalHoy = hoy.reduce((sum, d) => sum + (d.monto || 0), 0);
  const totalSemana = semana.reduce((sum, d) => sum + (d.monto || 0), 0);
  const totalMes = mes.reduce((sum, d) => sum + (d.monto || 0), 0);

  const ingresosHoy = hoy.filter(d => d.tipo === 'Ingreso').reduce((sum, d) => sum + d.monto, 0);
  const egresosHoy = hoy.filter(d => d.tipo === 'Egreso').reduce((sum, d) => sum + Math.abs(d.monto), 0);

  const pendientes = datos.filter(d => d.estado === 'Pendiente');
  const pendientesHoy = pendientes.filter(d => esHoy(d.fecha));
  const totalPendiente = pendientes.reduce((sum, d) => sum + (d.monto || 0), 0);

  return (
    `💰 *RESUMEN DE CAJA*\n\n` +
    `📅 *Hoy:*\n` +
    `   Ingresos: $${ingresosHoy.toLocaleString()}\n` +
    `   Egresos: $${egresosHoy.toLocaleString()}\n` +
    `   Neto: $${(ingresosHoy - egresosHoy).toLocaleString()}\n` +
    `   Pendientes: ${pendientesHoy.length}\n\n` +
    `📆 *Esta semana:* $${totalSemana.toLocaleString()}\n\n` +
    `📆 *Este mes:* $${totalMes.toLocaleString()}\n` +
    `   Movimientos: ${mes.length}\n` +
    `   Pendientes total: ${pendientes.length} ($${totalPendiente.toLocaleString()})`
  );
}

async function ejecutarHoy(userId) {
  const datos = await obtenerDatosSheet(userId);
  const hoy = datos.filter(d => esHoy(d.fecha));

  if (hoy.length === 0) {
    return '📭 No hay movimientos hoy.';
  }

  const ingresos = hoy.filter(d => d.tipo === 'Ingreso');
  const egresos = hoy.filter(d => d.tipo === 'Egreso');

  let msg = `📋 *MOVIMIENTOS DE HOY*\n\n`;

  if (ingresos.length > 0) {
    msg += `💰 *Ingresos:*\n`;
    ingresos.forEach(d => {
      msg += `✅ ${d.descripcion}\n`;
      msg += `   ${formatMonto(d.monto, d.moneda)} - ${d.metodoPago || 'pendiente'}\n\n`;
    });
  }

  if (egresos.length > 0) {
    msg += `💸 *Egresos:*\n`;
    egresos.forEach(d => {
      msg += `🔻 ${d.descripcion}\n`;
      msg += `   ${formatMonto(d.monto, d.moneda)} - ${d.metodoPago || 'pendiente'}\n\n`;
    });
  }

  const totalIngresos = ingresos.reduce((sum, d) => sum + d.monto, 0);
  const totalEgresos = egresos.reduce((sum, d) => sum + Math.abs(d.monto), 0);

  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `💰 Ingresos: $${totalIngresos.toLocaleString()}\n`;
  msg += `💸 Egresos: $${totalEgresos.toLocaleString()}\n`;
  msg += `💵 Neto: $${(totalIngresos - totalEgresos).toLocaleString()}`;

  return msg;
}

async function ejecutarSemana(userId) {
  const datos = await obtenerDatosSheet(userId);
  const semana = datos.filter(d => esEstaSemana(d.fecha));

  if (semana.length === 0) {
    return '📭 No hay movimientos esta semana.';
  }

  const ingresos = semana.filter(d => d.tipo === 'Ingreso');
  const egresos = semana.filter(d => d.tipo === 'Egreso');

  const totalIngresos = ingresos.reduce((sum, d) => sum + d.monto, 0);
  const totalEgresos = egresos.reduce((sum, d) => sum + Math.abs(d.monto), 0);

  const porDia = {};
  semana.forEach(d => {
    const fechaKey = formatFecha(d.fecha);
    if (!porDia[fechaKey]) {
      porDia[fechaKey] = { cantidad: 0, ingresos: 0, egresos: 0 };
    }
    porDia[fechaKey].cantidad++;
    if (d.tipo === 'Ingreso') {
      porDia[fechaKey].ingresos += d.monto;
    } else {
      porDia[fechaKey].egresos += Math.abs(d.monto);
    }
  });

  let msg = `📊 *RESUMEN SEMANAL*\n`;
  msg += `━━━━━━━━━━━━━━━━━\n\n`;

  Object.keys(porDia).sort((a, b) => {
    const dateA = normalizarFecha(a);
    const dateB = normalizarFecha(b);
    return dateA - dateB;
  }).forEach(fecha => {
    const info = porDia[fecha];
    msg += `📅 ${fecha}: ${info.cantidad} mov - $${(info.ingresos - info.egresos).toLocaleString()}\n`;
  });

  msg += `\n━━━━━━━━━━━━━━━\n`;
  msg += `💰 Ingresos: ${ingresos.length} - $${totalIngresos.toLocaleString()}\n`;
  msg += `💸 Egresos: ${egresos.length} - $${totalEgresos.toLocaleString()}\n\n`;
  msg += `💵 *Neto semanal: $${(totalIngresos - totalEgresos).toLocaleString()}*`;

  return msg;
}

async function ejecutarMes(userId) {
  const datos = await obtenerDatosSheet(userId);
  const mes = datos.filter(d => esEsteMes(d.fecha));

  if (mes.length === 0) {
    return '📭 No hay movimientos este mes. :(';
  }

  const ingresos = mes.filter(d => d.tipo === 'Ingreso');
  const egresos = mes.filter(d => d.tipo === 'Egreso');

  const totalIngresos = ingresos.reduce((sum, d) => sum + d.monto, 0);
  const totalEgresos = egresos.reduce((sum, d) => sum + Math.abs(d.monto), 0);

  const dolares = mes.filter(d => d.moneda === 'Dólares');
  const pesos = mes.filter(d => d.moneda === 'Pesos');

  let msg = `📊 *BALANCE DEL MES*\n`;
  msg += `━━━━━━━━━━━━━━━━━\n\n`;
  msg += `💰 Ingresos: ${ingresos.length} - $${totalIngresos.toLocaleString()}\n`;
  msg += `💸 Egresos: ${egresos.length} - $${totalEgresos.toLocaleString()}\n\n`;
  msg += `💵 *Neto: $${(totalIngresos - totalEgresos).toLocaleString()}*\n\n`;
  msg += `📊 *Por moneda:*\n`;
  msg += `   Pesos: ${pesos.length} movimientos\n`;
  msg += `   Dólares: ${dolares.length} movimientos`;

  return msg;
}

async function ejecutarIngresos(userId) {
  const datos = await obtenerDatosSheet(userId);
  const ingresos = datos.filter(d => d.tipo === 'Ingreso');

  if (ingresos.length === 0) {
    return '📭 No hay ingresos registrados.';
  }

  const ultimos = ingresos.slice(-20).reverse();

  let msg = `💰 *ÚLTIMOS INGRESOS*\n\n`;
  ultimos.forEach(d => {
    msg += `✅ ${d.descripcion}\n`;
    msg += `   ${formatMonto(d.monto, d.moneda)} - ${d.metodoPago || 'sin método'}\n`;
    msg += `   ${formatFecha(d.fecha)} ${d.hora}\n\n`;
  });

  const total = ingresos.reduce((sum, d) => sum + d.monto, 0);
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `💵 Total ingresos: $${total.toLocaleString()}`;

  return msg;
}

async function ejecutarEgresos(userId) {
  const datos = await obtenerDatosSheet(userId);
  const egresos = datos.filter(d => d.tipo === 'Egreso');

  if (egresos.length === 0) {
    return '📭 No hay egresos registrados.';
  }

  const ultimos = egresos.slice(-20).reverse();

  let msg = `💸 *ÚLTIMOS EGRESOS*\n\n`;
  ultimos.forEach(d => {
    msg += `🔻 ${d.descripcion}\n`;
    msg += `   ${formatMonto(d.monto, d.moneda)} - ${d.metodoPago || 'sin método'}\n`;
    msg += `   ${formatFecha(d.fecha)} ${d.hora}\n\n`;
  });

  const total = egresos.reduce((sum, d) => sum + Math.abs(d.monto), 0);
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `💵 Total egresos: $${total.toLocaleString()}`;

  return msg;
}

async function ejecutarPendientes(userId) {
  const datos = await obtenerDatosSheet(userId);
  const pendientes = datos.filter(d => d.estado === 'Pendiente');

  if (pendientes.length === 0) {
    return '✅ No hay movimientos pendientes. ¡Todo cobrado!';
  }

  const pendientesHoy = pendientes.filter(d => esHoy(d.fecha));
  const pendientesAntiguos = pendientes.filter(d => !esHoy(d.fecha));

  let msg = `⏳ *MOVIMIENTOS PENDIENTES*\n\n`;

  if (pendientesHoy.length > 0) {
    msg += `📅 *Hoy:*\n`;
    pendientesHoy.forEach(d => {
      msg += `• ${d.descripcion} - ${formatMonto(d.monto, d.moneda)}\n`;
    });
    msg += `\n`;
  }

  if (pendientesAntiguos.length > 0) {
    msg += `📆 *Anteriores:*\n`;
    pendientesAntiguos.slice(0, 10).forEach(d => {
      msg += `• ${d.descripcion} - ${formatFecha(d.fecha)} - ${formatMonto(d.monto, d.moneda)}\n`;
    });
    if (pendientesAntiguos.length > 10) {
      msg += `... y ${pendientesAntiguos.length - 10} más\n`;
    }
  }

  const totalPendiente = pendientes.reduce((sum, d) => sum + (d.monto || 0), 0);
  msg += `\n━━━━━━━━━━━━━━━\n`;
  msg += `💵 Total pendiente: $${totalPendiente.toLocaleString()}`;

  return msg;
}

async function ejecutarDolar() {
  if (!state.cotizacionDolar) {
    await obtenerCotizacionDolar();
    if (!state.cotizacionDolar) {
      return '❌ No se pudo obtener la cotización desde Bluelytics.\n\nPodés usar `/actualizardolar` para reintentar o configurar manualmente en .env con COTIZACION_DEFAULT.';
    }
  }

  const fechaFormateada = state.cotizacionFecha ? state.cotizacionFecha.toLocaleString('es-AR') : 'desconocida';
  return (
    `💵 *Cotización Dólar Blue*\n\n` +
    `📊 Promedio: $${state.cotizacionDolar.toLocaleString('es-AR')}\n` +
    `🕐 Actualizada: ${fechaFormateada}\n\n` +
    `Fuente: Bluelytics`
  );
}

async function ejecutarActualizarDolar() {
  const cotizacion = await obtenerCotizacionDolar();
  if (cotizacion) {
    return `✅ Cotización actualizada a $${cotizacion.toLocaleString('es-AR')}`;
  }
  return '❌ No se pudo actualizar la cotización.';
}

async function ejecutarCobrar(userId, nombre) {
  const filas = await db.getRows(userId);

  const pendientes = filas.filter(f => getRowEstado(f) === 'Pendiente');

  if (pendientes.length === 0) {
    return '✅ No hay movimientos pendientes.';
  }

  let filaActual = null;
  let montoCobrado = null;

  if (nombre) {
    const matchMonto = String(nombre).trim().match(/^(.*?)(?:\s+(\d+(?:[.,]\d{1,2})?))$/);
    if (matchMonto && matchMonto[1] && matchMonto[2]) {
      const montoParsed = parseFloat(matchMonto[2].replace(',', '.'));
      if (!Number.isNaN(montoParsed) && montoParsed > 0) {
        nombre = matchMonto[1].trim();
        montoCobrado = montoParsed;
      }
    }
  }

  if (nombre && nombre.toLowerCase() === 'ultimo') {
    filaActual = pendientes[pendientes.length - 1];
  } else if (nombre) {
    const textoLower = nombre.toLowerCase();
    filaActual = pendientes.find(f =>
      getRowDescripcion(f, '').toLowerCase().includes(textoLower)
    );
    if (!filaActual) {
      filaActual = pendientes.find(f => getRowIdUnico(f, '').toLowerCase() === textoLower);
    }
  }

  if (!filaActual) {
    let msg = `⏳ *Movimientos pendientes:*\n\n`;
    pendientes.slice(-5).forEach((f, i) => {
      msg += `• ${getRowDescripcion(f, '')}\n`;
    });
    msg += `\nUsa: /cobrar [nombre] o /cobrar [nombre] [monto]`;
    return msg;
  }

  const montoActual = getRowMonto(filaActual, 0);
  const saldoActual = Math.abs(montoActual);

  if (montoCobrado !== null) {
    if (montoCobrado > saldoActual) {
      return `⚠️ El cobro parcial supera el pendiente actual (${formatMonto(montoActual, getRowMoneda(filaActual, 'Pesos'))}).`;
    }

    if (montoCobrado < saldoActual) {
      const signo = montoActual < 0 ? -1 : 1;
      const nuevoSaldo = Math.round((saldoActual - montoCobrado) * 100) / 100;
      filaActual.set('Monto', signo * nuevoSaldo);
      filaActual.set('Estado', 'Pendiente');
      await filaActual.save();
      await aplicarColorMontoEnFila(filaActual, signo * nuevoSaldo, 'Pendiente');

      return (
        `🧾 *Cobro parcial registrado*\n\n` +
        `📝 ${getRowDescripcion(filaActual, '')}\n` +
        `💸 Cobrado ahora: ${formatMonto(montoCobrado, getRowMoneda(filaActual, 'Pesos'))}\n` +
        `⏳ Saldo pendiente: ${formatMonto(signo * nuevoSaldo, getRowMoneda(filaActual, 'Pesos'))}`
      );
    }
  }

  filaActual.set('Estado', 'Cobrado');
  await filaActual.save();
  await aplicarColorMontoEnFila(filaActual, montoActual, 'Cobrado');

  return (
    `✅ *¡Marcado como cobrado!*\n\n` +
    `📝 ${getRowDescripcion(filaActual, '')}`
  );
}

async function ejecutarEditar(userId, nombre) {
  if (!nombre) {
    return '📝 *Editar movimiento*\n\nUso: /editar [ID o nombre]\n\nPodrás modificar:\n• Descripción\n• Monto';
  }

  const filas = await db.getRows(userId);
  const textoLower = nombre.toLowerCase();

  const coincidencias = [];
  filas.forEach((f) => {
    const desc = getRowDescripcion(f, '').toLowerCase();
    const id = getRowIdUnico(f, '').toLowerCase();
    if (id === textoLower || desc.includes(textoLower)) {
      coincidencias.push(f);
    }
  });

  if (coincidencias.length === 0) {
    return '❌ No se encontró ningún movimiento.';
  }

  if (coincidencias.length > 1) {
    let msg = `⚠️ *Varias coincidencias:*\n\n`;
    coincidencias.slice(0, 5).forEach((c, i) => {
      msg += `${i + 1}. ${getRowDescripcion(c, '')}\n`;
      msg += `   ${formatMonto(getRowMonto(c, 0), getRowMoneda(c, 'Pesos'))} - ${getRowFecha(c)}\n\n`;
    });
    msg += `\nEspecificá mejor: /editar [ID completo]`;
    return msg;
  }

  return { fila: coincidencias[0], coincidencias };
}

async function ejecutarEliminar(userId, nombre) {
  if (!nombre) {
    return '⚠️ Uso: /eliminar [ID o nombre]\n\nEjemplo: /eliminar consulta Juan';
  }

  const filas = await db.getRows(userId);

  const textoLower = nombre.toLowerCase();
  const coincidencias = [];

  filas.forEach((f, index) => {
    const desc = getRowDescripcion(f, '').toLowerCase();
    const id = getRowIdUnico(f, '').toLowerCase();

    if (id === textoLower || desc.includes(textoLower)) {
      coincidencias.push({ fila: f, index });
    }
  });

  if (coincidencias.length === 0) {
    return '❌ No se encontró ningún movimiento con ese nombre.';
  }

  if (coincidencias.length > 1) {
    let msg = `⚠️ *Varias coincidencias (${coincidencias.length}):*\n\n`;
    coincidencias.slice(0, 5).forEach((c, i) => {
      const f = c.fila;
      const desc = getRowDescripcion(f);
      msg += `${i + 1}. ${desc}\n`;
      msg += `   ${formatMonto(getRowMonto(f, 0), getRowMoneda(f, 'Pesos'))} - ${getRowFecha(f)}\n\n`;
    });
    msg += `\nEspecificá mejor el nombre.`;
    return msg;
  }

  return { fila: coincidencias[0].fila, index: coincidencias[0].index, coincidencias };
}

async function ejecutarListar(userId) {
  const filas = await db.getRows(userId);

  if (filas.length === 0) {
    return '📭 No hay movimientos en el sheet.';
  }

  let msg = `📋 *Movimientos (últimos 10):*\n\n`;

  const ultimosMovimientos = filas.slice(-10).reverse();
  ultimosMovimientos.forEach((f, i) => {
    const desc = getRowDescripcion(f);
    const monto = getRowMonto(f, 0);
    const fecha = getRowFecha(f, '');
    const id = getRowIdUnico(f, 'sin-id');

    msg += `${i + 1}. ${desc}\n`;
    msg += `   $${monto} - ${fecha}\n`;
    msg += `   ID: \`${id}\`\n\n`;
  });

  msg += `\n💡 Usa /eliminar [nombre] para eliminar uno.`;

  return msg;
}

async function prepararEdicion(userId, nombre) {
  const result = await ejecutarEditar(userId, nombre);
  if (typeof result === 'string') {
    return result;
  }

  if (!result || !result.fila) {
    return '❌ Error al buscar movimiento.';
  }

  const montoActual = getRowMonto(result.fila, 0);
  const moneda = getRowMoneda(result.fila, 'Pesos');
  const descripcionActual = getRowDescripcion(result.fila, '');
  const tipo = getRowTipo(result.fila, 'Ingreso');

  return {
    state: {
      fila: result.fila,
      descripcionOriginal: descripcionActual,
      descripcion: descripcionActual,
      montoOriginal: montoActual,
      nuevoMonto: montoActual,
      moneda,
      tipo,
      step: 'descripcion'
    },
    mensaje:
      `📝 *Editar movimiento*\n\n` +
      `📝 Descripción actual: *${descripcionActual}*\n\n` +
      'Escribí la nueva descripción (o escribí "- -" para mantener la actual)'
  };
}

async function prepararEliminacion(userId, nombre) {
  const result = await ejecutarEliminar(userId, nombre);
  if (typeof result === 'string') {
    return result;
  }

  if (!result || !result.fila) {
    return '❌ Error al buscar movimiento.';
  }

  const fila = result.fila;
  const monto = getRowMonto(fila, 0);
  const moneda = getRowMoneda(fila, 'Pesos');
  const desc = getRowDescripcion(fila);
  const id = getRowIdUnico(fila, 'sin-id');
  const fecha = getRowFecha(fila, 'N/A');
  const hora = getRowHora(fila, 'N/A');
  const tipo = getRowTipo(fila, 'N/A');
  const metodo = getRowMetodoPago(fila, 'N/A');
  const estado = getRowEstado(fila, 'N/A');

  return {
    state: {
      fila,
      index: result.index,
      desc,
      monto,
      moneda,
      id,
      fecha,
      hora,
      tipo,
      metodo,
      estado
    },
    mensaje:
      `⚠️ *¿ELIMINAR ESTE MOVIMIENTO?*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📝 ${desc}\n` +
      `💰 ${formatMonto(monto, moneda)}\n` +
      `📅 ${fecha} ${hora}\n` +
      `🏷️ Tipo: ${tipo}\n` +
      `💳 Método: ${metodo}\n` +
      `📊 Estado: ${estado}\n` +
      `🆔 ${id}`
  };
}

async function guardarMovimiento(userId, datos, opciones = {}) {
  const { descripcion, monto, tipo, moneda, metodo_pago } = datos;
  const monedaFinal = (moneda === 'Dólares' || moneda === 'Dolares') ? 'Dólares' : 'Pesos';
  const montoFinal = parseFloat(monto);
  const estadoFinal = opciones.estado || datos.estado || 'Cobrado';

  let cotizacionUsada = opciones.cotizacionUsada || null;
  if (monedaFinal === 'Dólares' && !cotizacionUsada) {
    if (!state.cotizacionDolar) await obtenerCotizacionDolar();
    cotizacionUsada = state.cotizacionDolar;
  } else if (monedaFinal !== 'Dólares' && !state.cotizacionDolar) {
    await obtenerCotizacionDolar();
  }

  if (monedaFinal === 'Dólares' && !cotizacionUsada) {
    throw new Error('cotizacion_no_disponible');
  }

  const montoPesos = opciones.montoPesos || calcularMontoPesos(montoFinal, monedaFinal, cotizacionUsada);
  const { rowData, idUnico, fechaStr } = await persistirMovimiento(userId, {
    descripcion,
    monto: montoFinal,
    tipo,
    moneda: monedaFinal,
    metodoPago: metodo_pago,
    estado: estadoFinal,
    montoPesos,
  });

  return {
    success: true,
    rowData,
    idUnico,
    fechaStr,
    montoPesos,
    cotizacionUsada,
    mensaje: crearMensajeMovimientoRegistrado({
      tipo,
      descripcion,
      monto: montoFinal,
      moneda: monedaFinal,
      metodoPago: metodo_pago,
      fechaStr,
      idUnico,
      cotizacionUsada,
      montoPesos,
      estado: estadoFinal,
    })
  };
}

async function registrarMovimientoDesdeNLP(userId, datos) {
  const { tipo, descripcion, monto, moneda, metodo_pago, estado } = datos;
  const estadoFinal = estado === 'Pendiente' ? 'Pendiente' : 'Cobrado';

  if (!monto || isNaN(monto) || monto === 0) {
    return { necesitaInfo: true, campo: 'monto', mensaje: '💰 ¿De cuánto es el movimiento? Ingresá el monto:' };
  }

  if (!descripcion) {
    state.pendingDescripcion.set(userId, {
      tipo: tipo || 'ingreso',
      monto: parseFloat(monto),
      moneda: moneda || 'Pesos',
      metodo_pago: metodo_pago || null,
      estado: estadoFinal,
    });
    return { necesitaInfo: true, campo: 'descripcion', mensaje: '📝 ¿De quién o qué concepto es el movimiento?' };
  }

  let tipoFinal = 'Ingreso';
  let montoFinal = parseFloat(monto);

  if (tipo === 'gasto') {
    tipoFinal = 'Egreso';
    if (montoFinal > 0) montoFinal = -montoFinal;
  } else if (tipo === 'servicio') {
    tipoFinal = 'Ingreso';
  }

  const monedaFinal = (moneda === 'Dólares' || moneda === 'Dolares') ? 'Dólares' : 'Pesos';

  if (monedaFinal === 'Dólares') {
    state.pendingCotizaciones.set(userId, {
      comando: tipo === 'gasto' ? 'gasto' : 'consulta',
      descripcion: descripcion,
      monto: montoFinal,
      tipo: tipoFinal,
      moneda: monedaFinal,
      metodoIndicado: metodo_pago || null,
      estado: estadoFinal,
    });

    return {
      necesitaInfo: true,
      campo: 'cotizacion',
      mensaje: await construirMensajeCotizacion(montoFinal)
    };
  }

  if (!metodo_pago && estadoFinal !== 'Pendiente') {
    state.pendingPayments.set(userId, {
      descripcion: descripcion,
      monto: montoFinal,
      tipo: tipoFinal,
      moneda: monedaFinal,
      estado: estadoFinal,
    });

    return {
      necesitaInfo: true,
      campo: 'metodo_pago',
      mensaje: '💳 *¿Cómo pagaste?*\n\nResponde: efectivo / transferencia / tarjeta',
     _pendingData: { tipo: tipoFinal, descripcion, monto: montoFinal, moneda: monedaFinal }
    };
  }

  return guardarMovimiento(userId, {
    descripcion,
    monto: montoFinal,
    tipo: tipoFinal,
    moneda: monedaFinal,
    metodo_pago,
    estado: estadoFinal,
  });
}

module.exports = {
  ejecutarBalance,
  ejecutarHoy,
  ejecutarSemana,
  ejecutarMes,
  ejecutarIngresos,
  ejecutarEgresos,
  ejecutarPendientes,
  ejecutarDolar,
  ejecutarActualizarDolar,
  ejecutarCobrar,
  ejecutarEditar,
  ejecutarEliminar,
  ejecutarListar,
  prepararEdicion,
  prepararEliminacion,
  guardarMovimiento,
  registrarMovimientoDesdeNLP,
  construirMensajeCotizacion,
};
