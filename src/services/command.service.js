const { obtenerDatosSheet, getSheetCliente, invalidateCache } = require('./sheet.service');
const { withUserWriteLock } = require('../lib/write-queue');
const db = require('./db.service');
const { aplicarColorMontoEnFila } = require('./sheet-format.service');

const { esHoy, esEstaSemana, esEsteMes, normalizarFecha } = require('../utils/date');
const { formatMonto, formatFecha, escapeMarkdown } = require('../utils/formatter');
const { obtenerCotizacionDolar } = require('./cotizacion.service');
const { sanitizarInput } = require('../utils/formatter');
const { MAX_DESCRIPCION_LENGTH, MAX_MOVIMIENTO_MONTO, MAX_COTIZACION_DOLAR } = require('../config');
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
  getRowHora,
  getRowTipo,
  getRowMetodoPago,
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
    `Monto: U$${Math.abs(monto).toLocaleString('es-AR')}\n\n` +
    promedioActual +
    `Ingresá la cotización del dólar (ej: 1250):`
  );
}

async function ejecutarBalance(userId) {
  const datos = await obtenerDatosSheet(userId);

  const hoy = datos.filter(d => esHoy(d.fecha));
  const semana = datos.filter(d => esEstaSemana(d.fecha));
  const mes = datos.filter(d => esEsteMes(d.fecha));

  const ingresosHoy = hoy.filter(d => d.tipo === 'Ingreso').reduce((sum, d) => sum + (d.montoPesos || 0), 0);
  const egresosHoy = hoy.filter(d => d.tipo === 'Egreso').reduce((sum, d) => sum + Math.abs(d.montoPesos || 0), 0);

  const ingresosSemana = semana.filter(d => d.tipo === 'Ingreso').reduce((sum, d) => sum + (d.montoPesos || 0), 0);
  const egresosSemana = semana.filter(d => d.tipo === 'Egreso').reduce((sum, d) => sum + Math.abs(d.montoPesos || 0), 0);
  const totalSemana = ingresosSemana - egresosSemana;

  const ingresosMes = mes.filter(d => d.tipo === 'Ingreso').reduce((sum, d) => sum + (d.montoPesos || 0), 0);
  const egresosMes = mes.filter(d => d.tipo === 'Egreso').reduce((sum, d) => sum + Math.abs(d.montoPesos || 0), 0);
  const totalMes = ingresosMes - egresosMes;

  const pendientes = datos.filter(d => d.estado === 'Pendiente');
  const pendientesHoy = pendientes.filter(d => esHoy(d.fecha));
  const totalPendiente = pendientes.reduce((sum, d) => sum + (d.montoPesos || 0), 0);

  return (
    `💰 *RESUMEN DE CAJA*\n\n` +
    `📅 *Hoy:*\n` +
    `   Ingresos: $${ingresosHoy.toLocaleString('es-AR')}\n` +
    `   Egresos: $${egresosHoy.toLocaleString('es-AR')}\n` +
    `   Neto: $${(ingresosHoy - egresosHoy).toLocaleString('es-AR')}\n` +
    `   Pendientes: ${pendientesHoy.length}\n\n` +
    `📆 *Esta semana:* $${totalSemana.toLocaleString('es-AR')}\n\n` +
    `📆 *Este mes:* $${totalMes.toLocaleString('es-AR')}\n` +
    `   Movimientos: ${mes.length}\n` +
    `   Pendientes total: ${pendientes.length} ($${totalPendiente.toLocaleString('es-AR')})`
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
      msg += `✅ ${escapeMarkdown(d.descripcion)}\n`;
      msg += `   ${formatMonto(d.monto, d.moneda)} - ${d.metodoPago || 'pendiente'}\n\n`;
    });
  }

  if (egresos.length > 0) {
    msg += `💸 *Egresos:*\n`;
    egresos.forEach(d => {
      msg += `🔻 ${escapeMarkdown(d.descripcion)}\n`;
      msg += `   ${formatMonto(d.monto, d.moneda)} - ${d.metodoPago || 'pendiente'}\n\n`;
    });
  }

  const totalIngresos = ingresos.reduce((sum, d) => sum + (d.montoPesos || 0), 0);
  const totalEgresos = egresos.reduce((sum, d) => sum + Math.abs(d.montoPesos || 0), 0);

  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `💰 Ingresos: $${totalIngresos.toLocaleString('es-AR')}\n`;
  msg += `💸 Egresos: $${totalEgresos.toLocaleString('es-AR')}\n`;
  msg += `💵 Neto: $${(totalIngresos - totalEgresos).toLocaleString('es-AR')}`;

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

  const totalIngresos = ingresos.reduce((sum, d) => sum + (d.montoPesos || 0), 0);
  const totalEgresos = egresos.reduce((sum, d) => sum + Math.abs(d.montoPesos || 0), 0);

  const porDia = {};
  semana.forEach(d => {
    const fechaKey = formatFecha(d.fecha);
    if (!porDia[fechaKey]) {
      porDia[fechaKey] = { cantidad: 0, ingresos: 0, egresos: 0 };
    }
    porDia[fechaKey].cantidad++;
    if (d.tipo === 'Ingreso') {
      porDia[fechaKey].ingresos += (d.montoPesos || 0);
    } else {
      porDia[fechaKey].egresos += Math.abs(d.montoPesos || 0);
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
    msg += `📅 ${fecha}: ${info.cantidad} mov - $${(info.ingresos - info.egresos).toLocaleString('es-AR')}\n`;
  });

  msg += `\n━━━━━━━━━━━━━━━\n`;
  msg += `💰 Ingresos: ${ingresos.length} - $${totalIngresos.toLocaleString('es-AR')}\n`;
  msg += `💸 Egresos: ${egresos.length} - $${totalEgresos.toLocaleString('es-AR')}\n\n`;
  msg += `💵 *Neto semanal: $${(totalIngresos - totalEgresos).toLocaleString('es-AR')}*`;

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

  const totalIngresos = ingresos.reduce((sum, d) => sum + (d.montoPesos || 0), 0);
  const totalEgresos = egresos.reduce((sum, d) => sum + Math.abs(d.montoPesos || 0), 0);

  const dolares = mes.filter(d => d.moneda === 'Dólares');
  const pesos = mes.filter(d => d.moneda === 'Pesos');

  let msg = `📊 *BALANCE DEL MES*\n`;
  msg += `━━━━━━━━━━━━━━━━━\n\n`;
  msg += `💰 Ingresos: ${ingresos.length} - $${totalIngresos.toLocaleString('es-AR')}\n`;
  msg += `💸 Egresos: ${egresos.length} - $${totalEgresos.toLocaleString('es-AR')}\n\n`;
  msg += `💵 *Neto: $${(totalIngresos - totalEgresos).toLocaleString('es-AR')}*\n\n`;
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
    msg += `✅ ${escapeMarkdown(d.descripcion)}\n`;
    msg += `   ${formatMonto(d.monto, d.moneda)} - ${d.metodoPago || 'sin método'}\n`;
    msg += `   ${formatFecha(d.fecha)} ${d.hora}\n\n`;
  });

  const total = ingresos.reduce((sum, d) => sum + (d.montoPesos || 0), 0);
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `💵 Total ingresos: $${total.toLocaleString('es-AR')}`;

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
    msg += `🔻 ${escapeMarkdown(d.descripcion)}\n`;
    msg += `   ${formatMonto(d.monto, d.moneda)} - ${d.metodoPago || 'sin método'}\n`;
    msg += `   ${formatFecha(d.fecha)} ${d.hora}\n\n`;
  });

  const total = egresos.reduce((sum, d) => sum + Math.abs(d.montoPesos || 0), 0);
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `💵 Total egresos: $${total.toLocaleString('es-AR')}`;

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
      msg += `• ${escapeMarkdown(d.descripcion)} - ${formatMonto(d.monto, d.moneda)}\n`;
    });
    msg += `\n`;
  }

  if (pendientesAntiguos.length > 0) {
    msg += `📆 *Anteriores:*\n`;
    pendientesAntiguos.slice(0, 10).forEach(d => {
      msg += `• ${escapeMarkdown(d.descripcion)} - ${formatFecha(d.fecha)} - ${formatMonto(d.monto, d.moneda)}\n`;
    });
    if (pendientesAntiguos.length > 10) {
      msg += `... y ${pendientesAntiguos.length - 10} más\n`;
    }
  }

  const totalPendiente = pendientes.reduce((sum, d) => sum + (d.montoPesos || 0), 0);
  msg += `\n━━━━━━━━━━━━━━━\n`;
  msg += `💵 Total pendiente: $${totalPendiente.toLocaleString('es-AR')}`;

  return msg;
}

async function ejecutarCobrosPorMetodo(userId) {
  const datos = await obtenerDatosSheet(userId);
  const mes = datos.filter(d => esEsteMes(d.fecha));
  const cobrados = mes.filter(d => d.tipo === 'Ingreso' && d.estado === 'Cobrado');

  if (cobrados.length === 0) {
    return '📭 No hay ingresos cobrados este mes.';
  }

  const porMetodo = {};
  cobrados.forEach(d => {
    const metodo = (d.metodoPago && d.metodoPago.trim()) || 'Sin método';
    if (!porMetodo[metodo]) porMetodo[metodo] = { cantidad: 0, total: 0 };
    porMetodo[metodo].cantidad++;
    porMetodo[metodo].total += (d.montoPesos || 0);
  });

  const total = cobrados.reduce((sum, d) => sum + (d.montoPesos || 0), 0);

  let msg = `💳 *COBROS POR MÉTODO (mes)*\n`;
  msg += `━━━━━━━━━━━━━━━━━\n\n`;
  Object.keys(porMetodo)
    .sort((a, b) => porMetodo[b].total - porMetodo[a].total)
    .forEach(metodo => {
      const info = porMetodo[metodo];
      const pct = total > 0 ? Math.round((info.total / total) * 100) : 0;
      msg += `💰 *${escapeMarkdown(metodo)}*: $${info.total.toLocaleString('es-AR')} (${pct}%)\n`;
      msg += `   ${info.cantidad} mov\n\n`;
    });
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `💵 Total cobrado: $${total.toLocaleString('es-AR')}`;
  return msg;
}

async function ejecutarDeudores(userId) {
  const datos = await obtenerDatosSheet(userId);
  const pendientes = datos.filter(d => d.tipo === 'Ingreso' && d.estado === 'Pendiente');

  if (pendientes.length === 0) {
    return '✅ No hay deudores. ¡Todo cobrado!';
  }

  const porPaciente = {};
  pendientes.forEach(d => {
    const nombre = (d.paciente && d.paciente.trim()) ||
      (d.descripcion && d.descripcion.trim()) || 'Sin nombre';
    if (!porPaciente[nombre]) porPaciente[nombre] = { cantidad: 0, saldo: 0, vencimiento: '' };
    porPaciente[nombre].cantidad++;
    porPaciente[nombre].saldo += (d.montoPesos || 0);
    if (d.fechaVencimiento && !porPaciente[nombre].vencimiento) {
      porPaciente[nombre].vencimiento = d.fechaVencimiento;
    }
  });

  const total = pendientes.reduce((sum, d) => sum + (d.montoPesos || 0), 0);
  const nombres = Object.keys(porPaciente).sort((a, b) => porPaciente[b].saldo - porPaciente[a].saldo);

  let msg = `🧾 *DEUDORES (saldos pendientes)*\n`;
  msg += `━━━━━━━━━━━━━━━━━\n\n`;
  nombres.slice(0, 20).forEach(nombre => {
    const info = porPaciente[nombre];
    msg += `👤 *${escapeMarkdown(nombre)}*: $${info.saldo.toLocaleString('es-AR')}\n`;
    msg += `   ${info.cantidad} pendiente${info.cantidad > 1 ? 's' : ''}`;
    if (info.vencimiento) msg += ` · vence ${escapeMarkdown(info.vencimiento)}`;
    msg += `\n\n`;
  });
  if (nombres.length > 20) {
    msg += `... y ${nombres.length - 20} más\n\n`;
  }
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `💵 Total por cobrar: $${total.toLocaleString('es-AR')}`;
  return msg;
}

async function ejecutarEgresosCategoria(userId) {
  const datos = await obtenerDatosSheet(userId);
  const mes = datos.filter(d => esEsteMes(d.fecha));
  const egresos = mes.filter(d => d.tipo === 'Egreso');

  if (egresos.length === 0) {
    return '📭 No hay egresos este mes.';
  }

  const porCategoria = {};
  egresos.forEach(d => {
    const cat = (d.categoria && d.categoria.trim()) || 'sin categoría';
    if (!porCategoria[cat]) porCategoria[cat] = { cantidad: 0, total: 0 };
    porCategoria[cat].cantidad++;
    porCategoria[cat].total += Math.abs(d.montoPesos || 0);
  });

  const total = egresos.reduce((sum, d) => sum + Math.abs(d.montoPesos || 0), 0);

  let msg = `📊 *EGRESOS POR CATEGORÍA (mes)*\n`;
  msg += `━━━━━━━━━━━━━━━━━\n\n`;
  Object.keys(porCategoria)
    .sort((a, b) => porCategoria[b].total - porCategoria[a].total)
    .forEach(cat => {
      const info = porCategoria[cat];
      const pct = total > 0 ? Math.round((info.total / total) * 100) : 0;
      msg += `🔻 *${escapeMarkdown(cat)}*: $${info.total.toLocaleString('es-AR')} (${pct}%)\n`;
      msg += `   ${info.cantidad} mov\n\n`;
    });
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `💸 Total egresos: $${total.toLocaleString('es-AR')}`;
  return msg;
}

async function ejecutarPorProfesional(userId) {
  const datos = await obtenerDatosSheet(userId);
  const mes = datos.filter(d => esEsteMes(d.fecha) && d.tipo === 'Ingreso');

  if (mes.length === 0) {
    return '📭 No hay ingresos este mes.';
  }

  const porProf = {};
  mes.forEach(d => {
    const prof = (d.profesional && d.profesional.trim()) || 'Sin profesional';
    if (!porProf[prof]) porProf[prof] = { cantidad: 0, cobrado: 0, pendiente: 0, pendientesCount: 0 };
    porProf[prof].cantidad++;
    if (d.estado === 'Pendiente') {
      porProf[prof].pendiente += (d.montoPesos || 0);
      porProf[prof].pendientesCount++;
    } else {
      porProf[prof].cobrado += (d.montoPesos || 0);
    }
  });

  let msg = `👨‍⚕️ *INGRESOS POR PROFESIONAL (mes)*\n`;
  msg += `━━━━━━━━━━━━━━━━━\n\n`;
  Object.keys(porProf)
    .sort((a, b) => porProf[b].cobrado - porProf[a].cobrado)
    .forEach(prof => {
      const info = porProf[prof];
      msg += `👤 *${escapeMarkdown(prof)}*\n`;
      msg += `   ${info.cantidad} mov · cobrado $${info.cobrado.toLocaleString('es-AR')}\n`;
      if (info.pendiente > 0) {
        msg += `   ⏳ pendiente $${info.pendiente.toLocaleString('es-AR')} (${info.pendientesCount})\n`;
      }
      msg += `\n`;
    });

  const totalCobrado = mes
    .filter(d => d.estado !== 'Pendiente')
    .reduce((sum, d) => sum + (d.montoPesos || 0), 0);
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `💵 Total cobrado: $${totalCobrado.toLocaleString('es-AR')}`;
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
  return withUserWriteLock(userId, () => doEjecutarCobrar(userId, nombre));
}

// El lookup de la fila pendiente tiene que ir adentro del lock junto con el
// save: si quedara afuera, un delete/update concurrente del mismo usuario
// podria invalidar la fila entre el lookup y el guardado.
async function doEjecutarCobrar(userId, nombre) {
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
      msg += `• ${escapeMarkdown(getRowDescripcion(f, ''))}\n`;
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
        `📝 ${escapeMarkdown(getRowDescripcion(filaActual, ''))}\n` +
        `💸 Cobrado ahora: ${formatMonto(montoCobrado, getRowMoneda(filaActual, 'Pesos'))}\n` +
        `⏳ Saldo pendiente: ${formatMonto(signo * nuevoSaldo, getRowMoneda(filaActual, 'Pesos'))}`
      );
    }
  }

  const hoy = new Date();
  const hoyStr = `${hoy.getDate().toString().padStart(2, '0')}/${(hoy.getMonth() + 1).toString().padStart(2, '0')}/${hoy.getFullYear()}`;
  filaActual.set('Estado', 'Cobrado');
  filaActual.set('FechaCobro', hoyStr);
  await filaActual.save();
  await aplicarColorMontoEnFila(filaActual, montoActual, 'Cobrado');

  return (
    `✅ *¡Marcado como cobrado!*\n\n` +
    `📝 ${escapeMarkdown(getRowDescripcion(filaActual, ''))}`
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
      msg += `${i + 1}. ${escapeMarkdown(getRowDescripcion(c, ''))}\n`;
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
    let msg = '❌ No se encontró ningún movimiento con ese nombre o ID.\n\n';
    msg += '📋 *Últimos 5 movimientos:*\n\n';

    const ultimosMovimientos = filas.slice(-5).reverse();
    ultimosMovimientos.forEach((f, i) => {
      const desc = getRowDescripcion(f);
      const monto = getRowMonto(f, 0);
      const fecha = getRowFecha(f, '');
      msg += `${i + 1}. ${escapeMarkdown(desc)}\n`;
      msg += `   $${monto} - ${fecha}\n\n`;
    });

    msg += '💡 *Tip:* Intenta copiar parte del nombre exacto de arriba.';
    return msg;
  }

  if (coincidencias.length > 1) {
    let msg = `⚠️ *Varias coincidencias (${coincidencias.length}):*\n\n`;
    coincidencias.slice(0, 5).forEach((c, i) => {
      const f = c.fila;
      const desc = getRowDescripcion(f);
      msg += `${i + 1}. ${escapeMarkdown(desc)}\n`;
      msg += `   ${formatMonto(getRowMonto(f, 0), getRowMoneda(f, 'Pesos'))} - ${getRowFecha(f)}\n\n`;
    });
    msg += `\nEspecificá mejor el nombre o usa /listar para ver todos.`;
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

    msg += `${i + 1}. ${escapeMarkdown(desc)}\n`;
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
      `📝 ${escapeMarkdown(desc)}\n` +
      `💰 ${formatMonto(monto, moneda)}\n` +
      `📅 ${fecha} ${hora}\n` +
      `🏷️ Tipo: ${tipo}\n` +
      `💳 Método: ${metodo}\n` +
      `📊 Estado: ${estado}\n` +
      `🆔 ${id}`
  };
}

function buildHelpMessage() {
  return (
    '📖 *Comandos disponibles:*\n\n' +
    '📝 *Registrar movimiento:*\n' +
    '`consulta [paciente] $[monto] [metodo]`\n' +
    '`servicio [tratamiento] $[monto] [metodo]`\n' +
    '`gasto [descripcion] $-[monto]`\n' +
    '`pendiente [paciente/concepto] $[monto]`\n' +
    '`/pendiente [paciente/concepto] $[monto]`\n' +
    '`/ingreso_paciente` - Carga guiada con paciente, profesional y categoría\n\n' +
    '💬 *Primero intenta interpretar palabras clave sin IA.*\n' +
    'Si no alcanza, recurre al parser remoto para lenguaje natural.\n\n' +
    '📸 *Agenda por foto:*\n' +
    'Envía una foto de tu agenda o turnero para extraer y guardar turnos\n' +
    '`/editarturno` - Corregir datos de un turno de hoy\n\n' +
    '💵 *Monedas:*\n' +
    '$ - Pesos | U$ / USD - Dólares\n\n' +
    '💳 *Método de pago:*\n' +
    'efectivo / transferencia / tarjeta\n\n' +
    '📊 *Reportes:*\n' +
    '`/balance` - Resumen completo\n' +
    '`/hoy` - Movimientos de hoy\n' +
    '`/pendientes` - Sin cobrar\n' +
    '`/semana` - Resumen semanal\n' +
    '`/mes` - Balance del mes\n' +
    '`/ingresos` - Solo ingresos\n' +
    '`/egresos` - Solo gastos\n\n' +
    '📈 *Reportes de gestión:*\n' +
    '`/cobros_por_metodo` - Cobros del mes por método\n' +
    '`/egresos_categoria` - Egresos del mes por categoría\n' +
    '`/por_profesional` - Ingresos del mes por profesional\n' +
    '`/deudores` - Saldos pendientes por paciente\n\n' +
    '✅ *Cobrar:*\n' +
    '`/cobrar ultimo` - Cobra el último pendiente\n' +
    '`/cobrar [nombre]` - Cobra uno que coincida\n' +
    '`/cobrar [nombre] [monto]` - Registra cobro parcial\n\n' +
    '✏️ *Editar:*\n' +
    '`/editar [nombre]` - Editar descripción y monto\n\n' +
    '🗑️ *Eliminar:*\n' +
    '`/eliminar [nombre]` - Eliminar movimiento\n' +
    '`/listar` - Ver todos los movimientos\n\n' +
    '💵 *Dólar:*\n' +
    '`/dolar` - Ver cotización actual\n' +
    '`/actualizardolar` - Actualizar cotización\n\n' +
    '📄 *Sheet:*\n' +
    '`/sheet` - Ver link de tu Google Sheet'
  );
}

async function guardarMovimiento(userId, datos, opciones = {}) {
  const {
    descripcion,
    monto,
    tipo,
    moneda,
    metodo_pago,
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
  } = datos;
  const monedaFinal = (moneda === 'Dólares' || moneda === 'Dolares') ? 'Dólares'
    : (moneda === 'Euros' || moneda === 'euros' || moneda === 'EUR') ? 'Euros'
    : 'Pesos';
  const montoFinal = parseFloat(monto);
  const descripcionFinal = sanitizarInput(descripcion, MAX_DESCRIPCION_LENGTH);
  const estadoFinal = opciones.estado || datos.estado || 'Cobrado';

  if (!descripcionFinal || descripcionFinal.length < 2) {
    throw new Error('descripcion_invalida');
  }

  if (!Number.isFinite(montoFinal) || montoFinal === 0 || Math.abs(montoFinal) > MAX_MOVIMIENTO_MONTO) {
    throw new Error('monto_invalido');
  }

  let cotizacionUsada = opciones.cotizacionUsada || null;
  if (cotizacionUsada && (!Number.isFinite(cotizacionUsada) || cotizacionUsada <= 0 || cotizacionUsada > MAX_COTIZACION_DOLAR)) {
    throw new Error('cotizacion_invalida');
  }
  if (!state.cotizacionDolar) await obtenerCotizacionDolar();
  if (monedaFinal === 'Dólares' && !cotizacionUsada) {
    cotizacionUsada = state.cotizacionDolar;
  } else if (monedaFinal === 'Euros' && !cotizacionUsada) {
    cotizacionUsada = state.cotizacionEuro;
  }

  if (monedaFinal === 'Dólares' && !cotizacionUsada) {
    throw new Error('cotizacion_no_disponible');
  }
  if (monedaFinal === 'Euros' && !cotizacionUsada) {
    throw new Error('cotizacion_no_disponible');
  }

  const montoPesos = opciones.montoPesos || calcularMontoPesos(montoFinal, monedaFinal, cotizacionUsada);
  const { rowData, idUnico, fechaStr } = await persistirMovimiento(userId, {
    descripcion: descripcionFinal,
    monto: montoFinal,
    tipo,
    moneda: monedaFinal,
    metodoPago: metodo_pago,
    estado: estadoFinal,
    montoPesos,
    categoria: opciones.categoria || categoria || null,
    subcategoria: opciones.subcategoria || subcategoria || null,
    pacienteNombre: opciones.pacienteNombre || pacienteNombre || null,
    pagadorNombre: opciones.pagadorNombre || pagadorNombre || null,
    profesionalNombre: opciones.profesionalNombre || profesionalNombre || null,
    proveedorNombre: opciones.proveedorNombre || proveedorNombre || null,
    tratamientoNombre: opciones.tratamientoNombre || tratamientoNombre || null,
    fechaPrestacion: opciones.fechaPrestacion || fechaPrestacion || null,
    fechaCobroReal: opciones.fechaCobroReal || fechaCobroReal || null,
    fechaVencimiento: opciones.fechaVencimiento || fechaVencimiento || null,
    referenciaId: opciones.referenciaId || referenciaId || null,
    notas: mergeNotasConPagador(opciones.notas || notas || null, opciones.pagadorNombre || pagadorNombre || null),
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
      descripcion: descripcionFinal,
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

function normalizarTipoMovimiento(tipo, monto = null) {
  const raw = tipo == null ? '' : String(tipo).trim().toLowerCase();

  if (['gasto', 'egreso', 'salida', 'salio', 'salieron', 'se fue', 'se me fue'].includes(raw)) {
    return 'Egreso';
  }

  if (['ingreso', 'consulta', 'servicio', 'entro', 'entraron', 'entrada', 'me entro', 'me entraron'].includes(raw)) {
    return 'Ingreso';
  }

  if (monto !== null && monto !== undefined && parseFloat(monto) < 0) {
    return 'Egreso';
  }

  return 'Ingreso';
}

function inferirCategoriaInicial(tipo, estado = 'Cobrado', descripcion = '') {
  const raw = tipo == null ? '' : String(tipo).trim().toLowerCase();
  const desc = String(descripcion || '').trim().toLowerCase();

  if (['consulta'].includes(raw)) return 'consulta';
  if (['servicio', 'tratamiento'].includes(raw)) return 'tratamiento';
  if (['anticipo'].includes(raw)) return 'anticipo';
  if (['sena', 'seña'].includes(raw)) return 'sena';
  if (['cuota'].includes(raw)) return 'cuota';
  if (['saldo_final', 'saldo'].includes(raw)) return 'saldo_final';
  if (['gasto', 'egreso'].includes(raw)) {
    if (/sueld/.test(desc)) return 'sueldos';
    if (/honorario/.test(desc)) return 'honorarios';
    if (/insumo|guante|bracket|anestesia|material/.test(desc)) return 'insumos';
    if (/alquiler/.test(desc)) return 'alquiler';
    if (/expensa/.test(desc)) return 'expensas';
    if (/luz|agua|internet|telefono|servicio/.test(desc)) return 'servicios';
    if (/impuesto|iva|ingresos brutos|ganancia|monotributo/.test(desc)) return 'impuestos';
    if (/mantenimiento|autoclave|rayos x|sillon|equipo|reparacion/.test(desc)) return 'mantenimiento';
    if (/software|sistema|licencia|suscripcion/.test(desc)) return 'software';
    return 'otro_egreso';
  }
  if (estado === 'Pendiente') return 'cobro_pendiente';
  return null;
}

function mergeNotasConPagador(notas, pagadorNombre) {
  const notasBase = notas ? String(notas).trim() : '';
  const pagador = pagadorNombre ? sanitizarInput(pagadorNombre, MAX_DESCRIPCION_LENGTH) : '';

  if (!pagador) return notasBase || null;
  if (new RegExp(`(^|\\n)Pagador:\\s*${pagador.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n|$)`, 'i').test(notasBase)) {
    return notasBase || null;
  }

  return notasBase ? `${notasBase}\nPagador: ${pagador}` : `Pagador: ${pagador}`;
}

async function registrarMovimientoDesdeNLP(userId, datos) {
  const {
    tipo,
    descripcion,
    monto,
    moneda,
    metodo_pago,
    estado,
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
  } = datos;
  const estadoFinal = estado === 'Pendiente' ? 'Pendiente' : 'Cobrado';
  const categoriaFinal = categoria || inferirCategoriaInicial(tipo, estadoFinal, descripcion);
  const tratamientoNombreFinal = categoriaFinal === 'consulta'
    ? (tratamientoNombre || 'Consulta')
    : (tratamientoNombre || null);

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
      categoria: categoriaFinal,
      subcategoria: subcategoria || null,
      pacienteNombre: pacienteNombre || null,
      pagadorNombre: pagadorNombre || null,
      profesionalNombre: profesionalNombre || null,
      proveedorNombre: proveedorNombre || null,
      tratamientoNombre: tratamientoNombreFinal,
      fechaPrestacion: fechaPrestacion || null,
      fechaCobroReal: fechaCobroReal || null,
      fechaVencimiento: fechaVencimiento || null,
      referenciaId: referenciaId || null,
      notas: notas || null,
    });
    return { necesitaInfo: true, campo: 'descripcion', mensaje: '📝 ¿De quién o qué concepto es el movimiento?' };
  }

  let montoFinal = parseFloat(monto);
  const descripcionFinal = descripcion ? sanitizarInput(descripcion, MAX_DESCRIPCION_LENGTH) : null;

  const tipoFinal = normalizarTipoMovimiento(tipo, montoFinal);
  if (tipoFinal === 'Egreso' && montoFinal > 0) {
    montoFinal = -montoFinal;
  }

  const monedaFinal = (moneda === 'Dólares' || moneda === 'Dolares') ? 'Dólares'
    : (moneda === 'Euros' || moneda === 'euros' || moneda === 'EUR') ? 'Euros'
    : 'Pesos';

  if (monedaFinal === 'Dólares') {
    state.pendingCotizaciones.set(userId, {
      comando: tipoFinal === 'Egreso' ? 'gasto' : 'consulta',
      descripcion: descripcionFinal,
      monto: montoFinal,
      tipo: tipoFinal,
      moneda: monedaFinal,
      metodoIndicado: metodo_pago || null,
      estado: estadoFinal,
      categoria: categoriaFinal,
      subcategoria: subcategoria || null,
      pacienteNombre: pacienteNombre || null,
      pagadorNombre: pagadorNombre || null,
      profesionalNombre: profesionalNombre || null,
      proveedorNombre: proveedorNombre || null,
      tratamientoNombre: tratamientoNombreFinal,
      fechaPrestacion: fechaPrestacion || null,
      fechaCobroReal: fechaCobroReal || null,
      fechaVencimiento: fechaVencimiento || null,
      referenciaId: referenciaId || null,
      notas: notas || null,
    });

    return {
      necesitaInfo: true,
      campo: 'cotizacion',
      mensaje: await construirMensajeCotizacion(montoFinal)
    };
  }

  if (monedaFinal === 'Euros') {
    if (!state.cotizacionDolar) await obtenerCotizacionDolar();
    const cotizacionEuro = state.cotizacionEuro;
    if (!cotizacionEuro) throw new Error('cotizacion_no_disponible');
    return guardarMovimiento(userId, {
      descripcion: descripcionFinal,
      monto: montoFinal,
      tipo: tipoFinal,
      moneda: monedaFinal,
      metodo_pago: metodo_pago || null,
      estado: estadoFinal,
      categoria: categoriaFinal,
      subcategoria,
      pacienteNombre,
      pagadorNombre,
      profesionalNombre,
      proveedorNombre,
      tratamientoNombre: tratamientoNombreFinal,
      fechaPrestacion,
      fechaCobroReal,
      fechaVencimiento,
      referenciaId,
      notas,
    }, { cotizacionUsada: cotizacionEuro, estado: estadoFinal });
  }

  if (!metodo_pago && estadoFinal !== 'Pendiente') {
    state.pendingPayments.set(userId, {
      descripcion: descripcionFinal,
      monto: montoFinal,
      tipo: tipoFinal,
      moneda: monedaFinal,
      estado: estadoFinal,
      categoria: categoriaFinal,
      subcategoria: subcategoria || null,
      pacienteNombre: pacienteNombre || null,
      pagadorNombre: pagadorNombre || null,
      profesionalNombre: profesionalNombre || null,
      proveedorNombre: proveedorNombre || null,
      tratamientoNombre: tratamientoNombreFinal,
      fechaPrestacion: fechaPrestacion || null,
      fechaCobroReal: fechaCobroReal || null,
      fechaVencimiento: fechaVencimiento || null,
      referenciaId: referenciaId || null,
      notas: notas || null,
    });

    return {
      necesitaInfo: true,
      campo: 'metodo_pago',
      mensaje: '💳 *¿Cómo pagaste?*\n\nResponde: efectivo / transferencia / tarjeta',
     _pendingData: { tipo: tipoFinal, descripcion: descripcionFinal, monto: montoFinal, moneda: monedaFinal }
    };
  }

  return guardarMovimiento(userId, {
    descripcion: descripcionFinal,
    monto: montoFinal,
    tipo: tipoFinal,
    moneda: monedaFinal,
    metodo_pago,
    estado: estadoFinal,
      categoria: categoriaFinal,
      subcategoria,
      pacienteNombre,
      pagadorNombre,
      profesionalNombre,
      proveedorNombre,
      tratamientoNombre: tratamientoNombreFinal,
    fechaPrestacion,
    fechaCobroReal,
    fechaVencimiento,
    referenciaId,
    notas,
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
  ejecutarCobrosPorMetodo,
  ejecutarDeudores,
  ejecutarEgresosCategoria,
  ejecutarPorProfesional,
  ejecutarDolar,
  ejecutarActualizarDolar,
  ejecutarCobrar,
  ejecutarEditar,
  ejecutarEliminar,
  ejecutarListar,
  prepararEdicion,
  prepararEliminacion,
  buildHelpMessage,
  guardarMovimiento,
  registrarMovimientoDesdeNLP,
  construirMensajeCotizacion,
};
