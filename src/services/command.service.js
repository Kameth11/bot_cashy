const { obtenerDatosSheet, getSheetCliente, invalidateCache } = require('./sheet.service');
const db = require('./db.service');

const { esHoy, esEstaSemana, esEsteMes, normalizarFecha } = require('../utils/date');
const { formatMonto, formatFecha } = require('../utils/formatter');
const { obtenerCotizacionDolar } = require('./cotizacion.service');
const { generarIDUnico, convertirAPesos } = require('./movimiento.service');
const { obtenerClientePorUserId } = require('../auth');
const state = require('../state');

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

  const pendientes = filas.filter(f => (f.get('Estado') || f.get('estado')) === 'Pendiente');

  if (pendientes.length === 0) {
    return '✅ No hay movimientos pendientes.';
  }

  let filaActual = null;

  if (nombre && nombre.toLowerCase() === 'ultimo') {
    filaActual = pendientes[pendientes.length - 1];
  } else if (nombre) {
    const textoLower = nombre.toLowerCase();
    filaActual = pendientes.find(f =>
      (f.get('Descripcion') || f.get('descripcion') || '').toLowerCase().includes(textoLower)
    );
  }

  if (!filaActual) {
    let msg = `⏳ *Movimientos pendientes:*\n\n`;
    pendientes.slice(-5).forEach((f, i) => {
      msg += `• ${f.get('Descripcion') || f.get('descripcion')}\n`;
    });
    msg += `\nDecime el nombre: "cobrar [nombre]" o /cobrar [nombre]`;
    return msg;
  }

  filaActual.set('Estado', 'Cobrado');
  await filaActual.save();

  return (
    `✅ *¡Marcado como cobrado!*\n\n` +
    `📝 ${filaActual.get('Descripcion') || filaActual.get('descripcion')}`
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
    const desc = (f.get('Descripcion') || f.get('descripcion') || '').toLowerCase();
    const id = (f.get('ID_Unico') || f.get('ID_unico') || f.get('ID_uNico') || f.get('idunico') || '').toLowerCase();
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
      msg += `${i + 1}. ${c.get('Descripcion') || c.get('descripcion')}\n`;
      msg += `   ${formatMonto(parseFloat(c.get('Monto') || c.get('monto') || 0), c.get('Moneda') || c.get('moneda') || 'Pesos')} - ${c.get('Fecha') || c.get('fecha')}\n\n`;
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
    const desc = (
      f.get('Descripcion') ||
      f.get('descripcion') ||
      f.get('Paciente') ||
      f.get('paciente') ||
      f.get('Nombre') ||
      f.get('nombre') ||
      ''
    ).toLowerCase();

    const id = (
      f.get('ID_Unico') ||
      f.get('ID_unico') ||
      f.get('ID_uNico') ||
      f.get('idunico') ||
      ''
    ).toLowerCase();

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
      const desc = f.get('Descripcion') || f.get('descripcion') || f.get('Paciente') || f.get('paciente') || f.get('Nombre') || f.get('nombre') || 'Sin descripción';
      msg += `${i + 1}. ${desc}\n`;
      msg += `   ${formatMonto(parseFloat(f.get('Monto') || f.get('monto') || 0), f.get('Moneda') || f.get('moneda') || 'Pesos')} - ${f.get('Fecha') || f.get('fecha')}\n\n`;
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
    const desc = f.get('Descripcion') || f.get('descripcion') || f.get('Paciente') || f.get('paciente') || f.get('Nombre') || f.get('nombre') || 'Sin descripción';
    const monto = f.get('Monto') || f.get('monto') || '0';
    const fecha = f.get('Fecha') || f.get('fecha') || '';
    const id = f.get('ID_Unico') || f.get('ID_unico') || f.get('ID_uNico') || f.get('idunico') || 'sin-id';

    msg += `${i + 1}. ${desc}\n`;
    msg += `   $${monto} - ${fecha}\n`;
    msg += `   ID: \`${id}\`\n\n`;
  });

  msg += `\n💡 Usa /eliminar [nombre] para eliminar uno.`;

  return msg;
}

async function registrarMovimientoDesdeNLP(userId, datos) {
  const { tipo, descripcion, monto, moneda, metodo_pago } = datos;

  if (!monto || isNaN(monto) || monto === 0) {
    return { necesitaInfo: true, campo: 'monto', mensaje: '💰 ¿De cuánto es el movimiento? Ingresá el monto:' };
  }

  if (!descripcion) {
    state.pendingDescripcion.set(userId, {
      tipo: tipo || 'ingreso',
      monto: parseFloat(monto),
      moneda: moneda || 'Pesos',
      metodo_pago: metodo_pago || null
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
      metodoIndicado: metodo_pago || null
    });

    return {
      necesitaInfo: true,
      campo: 'cotizacion',
      mensaje: `💵 *Movimiento en dólares*\n\nMonto: U$${Math.abs(montoFinal).toLocaleString()}\n\nIngresá la cotización del dólar (ej: 1250):`
    };
  }

  if (!metodo_pago) {
    state.pendingPayments.set(userId, {
      descripcion: descripcion,
      monto: montoFinal,
      tipo: tipoFinal,
      moneda: monedaFinal
    });

    return {
      necesitaInfo: true,
      campo: 'metodo_pago',
      mensaje: '💳 *¿Cómo pagaste?*\n\nResponde: efectivo / transferencia / tarjeta',
     _pendingData: { tipo: tipoFinal, descripcion, monto: montoFinal, moneda: monedaFinal }
    };
  }

  const now = new Date();
  const fechaStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
  const horaStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  if (!state.cotizacionDolar) await obtenerCotizacionDolar();
  const montoPesos = convertirAPesos(montoFinal, monedaFinal);

  const cliente = obtenerClientePorUserId(userId);
  const idOrigen = cliente ? (cliente.email || cliente.telegramUserId || userId) : userId;

  const idUnico = generarIDUnico();

  const rowData = {
    'Fecha': fechaStr,
    'Hora': horaStr,
    'Descripcion': descripcion,
    'Monto': montoFinal,
    'Estado': 'Cobrado',
    'Tipo': tipoFinal,
    'Moneda': monedaFinal,
    'MetodoPago': metodo_pago,
    'ID_Unico': idUnico,
    'MontoPesos': montoPesos,
    'ID_Origen': idOrigen
  };

  await db.addRow(userId, rowData);

  const tipoTexto = tipoFinal === 'Ingreso' ? 'Ingreso' : 'Gasto';
  const tipoEmoji = tipoFinal === 'Ingreso' ? '💰' : '💸';

  return {
    success: true,
    mensaje: (
      `${tipoEmoji} *¡${tipoTexto} registrado!*\n\n` +
      `📝 Descripción: ${descripcion}\n` +
      `💰 Monto: ${formatMonto(montoFinal, monedaFinal)}\n` +
      `💳 Método: ${metodo_pago}\n` +
      `📅 Fecha: ${fechaStr}\n` +
      `🆔 ID: \`${idUnico}\``
    )
  };
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
  registrarMovimientoDesdeNLP,
};