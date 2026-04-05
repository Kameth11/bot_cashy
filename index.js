require('dotenv').config();
const { Telegraf } = require('telegraf');
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const BOT_TOKEN = process.env.BOT_TOKEN;
const AUTHORIZED_USER_ID = parseInt(process.env.AUTHORIZED_USER_ID, 10);
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

if (!BOT_TOKEN || !SPREADSHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
  console.error('Faltan variables de entorno. Revisa tu archivo .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const serviceAccountAuth = new JWT({
  email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: GOOGLE_PRIVATE_KEY,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

const pendingPayments = new Map();

const METODOS_VALIDOS = ['efectivo', 'transferencia', 'tarjeta'];
const COMANDOS_INGRESO = ['consulta', 'servicio'];
const COMANDOS_EGRESO = ['gasto'];

function sanitizarInput(texto, maxLength = 200) {
  if (!texto || typeof texto !== 'string') return '';
  return texto.slice(0, maxLength).replace(/[<>\"'&]/g, '').trim();
}

function esMonedaValida(moneda) {
  return ['$', 'U$', 'USD'].includes(moneda);
}

bot.use((ctx, next) => {
  if (ctx.from && ctx.from.id === AUTHORIZED_USER_ID) {
    return next();
  }
  if (ctx.from) {
    console.log(`Acceso denegado: ${ctx.from.id}`);
    ctx.reply('No tienes autorización para usar este bot.');
  }
  return next();
});

async function obtenerDatosSheet() {
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  const filas = await sheet.getRows();
  
  return filas.map(row => {
    const rowObj = row.toObject ? row.toObject() : row;
    return {
      fecha: rowObj.Fecha || rowObj.fecha || '',
      hora: rowObj.Hora || rowObj.hora || '',
      descripcion: rowObj.Descripcion || rowObj.descripcion || rowObj.Paciente || '',
      monto: parseFloat(rowObj.Monto || rowObj.monto || 0),
      estado: rowObj.Estado || rowObj.estado || '',
      tipo: rowObj.Tipo || rowObj.tipo || '',
      moneda: rowObj.Moneda || rowObj.moneda || 'Pesos',
      metodoPago: rowObj.MetodoPago || rowObj.metodopago || '',
      idUnico: rowObj.ID_uNico || rowObj.idunico || ''
    };
  });
}

function normalizarFecha(fechaStr) {
  if (!fechaStr) return null;
  const partes = fechaStr.split('/');
  if (partes.length === 3) {
    return new Date(partes[2], partes[1] - 1, partes[0]);
  }
  const date = new Date(fechaStr);
  return isNaN(date.getTime()) ? null : date;
}

function esHoy(fechaStr) {
  const fecha = normalizarFecha(fechaStr);
  if (!fecha) return false;
  const hoy = new Date();
  return fecha.getDate() === hoy.getDate() &&
         fecha.getMonth() === hoy.getMonth() &&
         fecha.getFullYear() === hoy.getFullYear();
}

function esEstaSemana(fechaStr) {
  const fecha = normalizarFecha(fechaStr);
  if (!fecha) return false;
  const hoy = new Date();
  const inicioSemana = new Date(hoy);
  inicioSemana.setDate(hoy.getDate() - 6);
  return fecha >= inicioSemana && fecha <= hoy;
}

function esEsteMes(fechaStr) {
  const fecha = normalizarFecha(fechaStr);
  if (!fecha) return false;
  const hoy = new Date();
  return fecha.getMonth() === hoy.getMonth() &&
         fecha.getFullYear() === hoy.getFullYear();
}

function formatFecha(fechaStr) {
  if (!fechaStr) return '';
  return fechaStr;
}

function formatMonto(monto, moneda) {
  const monedaSimbolo = moneda === 'Dólares' ? 'U$' : '$';
  const montoAbs = Math.abs(monto);
  return monto < 0 ? `-${monedaSimbolo}${montoAbs.toLocaleString()}` : `${monedaSimbolo}${montoAbs.toLocaleString()}`;
}

bot.command('start', (ctx) => {
  ctx.reply(
    '👋 ¡Hola! Soy tu bot de cashflow para consultorio.\n\n' +
    '📝 *Registrar movimiento:*\n' +
    '`consulta Juan Perez $15000 efectivo` (ingreso pesos)\n' +
    '`servicio Endodoncia U$50 transferencia` (ingreso dólares)\n' +
    '`gasto Insumos $-500` (egreso)\n\n' +
    '📊 *Reportes:*\n' +
    '`/balance` - Resumen completo\n' +
    '`/hoy` - Movimientos de hoy\n' +
    '`/pendientes` - Sin cobrar\n\n' +
    '`/ayuda` - Ver todos los comandos',
    { parse_mode: 'Markdown' }
  );
});

bot.command('ayuda', (ctx) => {
  ctx.reply(
    '📖 *Comandos disponibles:*\n\n' +
    '📝 *Registrar movimiento:*\n' +
    '`consulta [paciente] $[monto] [metodo]`\n' +
    '`servicio [tratamiento] $[monto] [metodo]`\n' +
    '`gasto [descripcion] $-[monto]`\n\n' +
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
    '✅ *Cobrar:*\n' +
    '`/cobrar ultimo` - Cobra el último pendiente\n' +
    '`/cobrar [nombre]` - Cobra uno que coincida',
    { parse_mode: 'Markdown' }
  );
});

bot.command('balance', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet();
    
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
    
    const msg = 
      `💰 *RESUMEN DE CAJA*\n\n` +
      `📅 *Hoy:*\n` +
      `   Ingresos: $${ingresosHoy.toLocaleString()}\n` +
      `   Egresos: $${egresosHoy.toLocaleString()}\n` +
      `   Neto: $${(ingresosHoy - egresosHoy).toLocaleString()}\n` +
      `   Pendientes: ${pendientesHoy.length}\n\n` +
      `📆 *Esta semana:* $${totalSemana.toLocaleString()}\n\n` +
      `📆 *Este mes:* $${totalMes.toLocaleString()}\n` +
      `   Movimientos: ${mes.length}\n` +
      `   Pendientes total: ${pendientes.length} ($${totalPendiente.toLocaleString()})`;
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /balance:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

bot.command('hoy', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet();
    const hoy = datos.filter(d => esHoy(d.fecha));
    
    if (hoy.length === 0) {
      return ctx.reply('📭 No hay movimientos hoy.');
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
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /hoy:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

bot.command('pendientes', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet();
    const pendientes = datos.filter(d => d.estado === 'Pendiente');
    
    if (pendientes.length === 0) {
      return ctx.reply('✅ No hay movimientos pendientes. ¡Todo cobrado!');
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
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /pendientes:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

bot.command('semana', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet();
    const semana = datos.filter(d => esEstaSemana(d.fecha));
    
    if (semana.length === 0) {
      return ctx.reply('📭 No hay movimientos esta semana.');
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
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /semana:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

bot.command('mes', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet();
    const mes = datos.filter(d => esEsteMes(d.fecha));
    
    if (mes.length === 0) {
      return ctx.reply('📭 No hay movimientos este mes.');
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
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /mes:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

bot.command('ingresos', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet();
    const ingresos = datos.filter(d => d.tipo === 'Ingreso');
    
    if (ingresos.length === 0) {
      return ctx.reply('📭 No hay ingresos registrados.');
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
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /ingresos:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

bot.command('egresos', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet();
    const egresos = datos.filter(d => d.tipo === 'Egreso');
    
    if (egresos.length === 0) {
      return ctx.reply('📭 No hay egresos registrados.');
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
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /egresos:', error.message);
    ctx.reply('❌ Error al obtener datos');
  }
});

bot.command('cobrar', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1);
    await ctx.reply('⏳ Buscando...');
    
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const filas = await sheet.getRows();
    
    const pendientes = filas.filter(f => (f.Estado || f.estado) === 'Pendiente');
    
    if (pendientes.length === 0) {
      return ctx.reply('✅ No hay movimientos pendientes.');
    }
    
    let filaActual = null;
    
    if (args.length > 0 && args[0] === 'ultimo') {
      filaActual = pendientes[pendientes.length - 1];
    } else {
      const texto = ctx.message.text.replace('/cobrar', '').trim().toLowerCase();
      filaActual = pendientes.find(f => 
        (f.Descripcion || f.descripcion || '').toLowerCase().includes(texto)
      );
      if (!filaActual && texto) {
        filaActual = pendientes.find(f => 
          (f.ID_uNico || f.idunico || '') === texto
        );
      }
    }
    
    if (!filaActual) {
      let msg = `⏳ *Movimientos pendientes:*\n\n`;
      pendientes.slice(-5).forEach((f, i) => {
        msg += `• ${f.Descripcion || f.descripcion}\n`;
      });
      msg += `\nUsa: /cobrar [nombre]`;
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }
    
    filaActual.Estado = 'Cobrado';
    await filaActual.save();
    
    ctx.reply(
      `✅ *¡Marcado como cobrado!*\n\n` +
      `📝 ${filaActual.Descripcion || filaActual.descripcion}`,
      { parse_mode: 'Markdown' }
    );
    
  } catch (error) {
    console.error('Error /cobrar:', error.message);
    ctx.reply('❌ Error al actualizar estado.');
  }
});

const regexMsg = /^(consulta|servicio|gasto)\s+(.+?)\s+(?:\$|U\$|USD)?\s*(-?\d+(?:\.\d{1,2})?)\s*((?:efectivo|transferencia|tarjeta))?$/i;

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  
  if (text.startsWith('/')) return;
  
  if (pendingPayments.has(ctx.from.id)) {
    const metodo = text.toLowerCase().trim();
    if (METODOS_VALIDOS.includes(metodo)) {
      const pendingData = pendingPayments.get(ctx.from.id);
      try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        
        const now = new Date();
        const fechaStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
        const horaStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        
        const rowData = {
          'Fecha': fechaStr,
          'Hora': horaStr,
          'Descripcion': pendingData.descripcion,
          'Monto': pendingData.monto,
          'Estado': 'Cobrado',
          'Tipo': pendingData.tipo,
          'Moneda': pendingData.moneda,
          'MetodoPago': metodo,
          'ID_unico': `mov_${Date.now()}`
        };
        
        await sheet.addRow(rowData);
        
        const tipoEmoji = pendingData.tipo === 'Ingreso' ? '💰' : '💸';
        
        ctx.reply(
          `${tipoEmoji} *¡${pendingData.tipo} registrado!*\n\n` +
          `📝 Descripción: ${pendingData.descripcion}\n` +
          `💰 Monto: ${formatMonto(pendingData.monto, pendingData.moneda)}\n` +
          `💳 Método: ${metodo}\n` +
          `📅 Fecha: ${fechaStr}`,
          { parse_mode: 'Markdown' }
        );
        
        pendingPayments.delete(ctx.from.id);
      } catch (error) {
        console.error('Error al guardar:', error.message);
        ctx.reply('❌ Error al guardar en Google Sheets.');
        pendingPayments.delete(ctx.from.id);
      }
      return;
    } else {
      ctx.reply('⚠️ Método no válido. Responde: efectivo / transferencia / tarjeta');
      return;
    }
  }
  
  const match = text.match(regexMsg);
  if (!match) {
    return ctx.reply(
      '⚠️ Formato no válido.\n\n' +
      'Usa: `consulta [paciente] $[monto] [metodo]`\n' +
      'Ejemplo: `consulta Juan Perez $15000 efectivo`\n\n' +
      'O: `/ayuda`',
      { parse_mode: 'Markdown' }
    );
  }
  
  const comando = match[1].toLowerCase();
  const descripcion = sanitizarInput(match[2]);
  const monto = parseFloat(match[3]);
  
  let tipo = '';
  let moneda = 'Pesos';
  
  const textOriginal = text.toLowerCase();
  if (textOriginal.includes('u$') || textOriginal.includes('usd')) {
    moneda = 'Dólares';
  }
  
  if (COMANDOS_INGRESO.includes(comando)) {
    tipo = 'Ingreso';
  } else if (COMANDOS_EGRESO.includes(comando)) {
    tipo = 'Egreso';
    if (monto > 0) monto = -monto;
  }
  
  const metodoIndicado = match[4] ? match[4].toLowerCase() : null;
  
  if (!metodoIndicado) {
    pendingPayments.set(ctx.from.id, {
      descripcion,
      monto,
      tipo,
      moneda
    });
    
    ctx.reply(
      `💳 *¿Cómo pagaste?*\n\n` +
      `Responde: efectivo / transferencia / tarjeta`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  if (isNaN(monto) || monto === 0) {
    return ctx.reply('❌ Error: El monto no puede ser 0.');
  }
  
  try {
    await ctx.reply('⏳ Registrando...');
    
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    
    const now = new Date();
    const fechaStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
    const horaStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    const rowData = {
      'Fecha': fechaStr,
      'Hora': horaStr,
      'Descripcion': descripcion,
      'Monto': monto,
      'Estado': 'Cobrado',
      'Tipo': tipo,
      'Moneda': moneda,
      'MetodoPago': metodoIndicado,
      'ID_unico': `mov_${Date.now()}`
    };
    
    await sheet.addRow(rowData);
    
    const tipoTexto = tipo === 'Ingreso' ? 'Ingreso' : 'Gasto';
    const tipoEmoji = tipo === 'Ingreso' ? '💰' : '💸';
    
    ctx.reply(
      `${tipoEmoji} *¡${tipoTexto} registrado!*\n\n` +
      `📝 Descripción: ${descripcion}\n` +
      `💰 Monto: ${formatMonto(monto, moneda)}\n` +
      `💳 Método: ${metodoIndicado}\n` +
      `📅 Fecha: ${fechaStr}`,
      { parse_mode: 'Markdown' }
    );
    
  } catch (error) {
    console.error('Error al guardar:', error.message);
    ctx.reply('❌ Error al guardar en Google Sheets.');
  }
});

bot.launch().then(() => {
  console.log('Bot iniciado correctamente');
}).catch(err => {
  console.error('Error al iniciar:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
