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
  console.error('❌ Faltan variables de entorno. Revisa tu archivo .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const serviceAccountAuth = new JWT({
  email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: GOOGLE_PRIVATE_KEY,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

bot.use((ctx, next) => {
  if (ctx.from && ctx.from.id === AUTHORIZED_USER_ID) {
    return next();
  }
  if (ctx.from) {
    console.log(`⚠️ Acceso denegado: ${ctx.from.id} (@${ctx.from.username || 'sin_usuario'})`);
    ctx.reply('⛔ No tienes autorización para usar este bot.');
  }
  return next();
});

async function obtenerDatosSheet() {
  console.log('🔍 [DEBUG-READ] 1. Iniciando lectura de Sheet...');
  await doc.loadInfo();
  console.log('🔍 [DEBUG-READ] 2. Doc cargado:', doc.title);
  
  const sheet = doc.sheetsByIndex[0];
  console.log('🔍 [DEBUG-READ] 3. Sheet:', sheet.title);
  
  const filas = await sheet.getRows();
  console.log('🔍 [DEBUG-READ] 4. Filas obtenidas:', filas.length);
  
  if (filas.length > 0) {
    console.log('🔍 [DEBUG-READ] 5. Primera fila headers:', Object.keys(filas[0]));
    const rowObj = filas[0].toObject ? filas[0].toObject() : filas[0];
    console.log('🔍 [DEBUG-READ] 6. Primera fila datos:', JSON.stringify(rowObj));
  }
  
  const datos = filas.map(row => {
    const rowObj = row.toObject ? row.toObject() : row;
    return {
      fecha: rowObj.Fecha || rowObj.fecha || '',
      hora: rowObj.Hora || rowObj.hora || '',
      paciente: rowObj.Paciente || rowObj.paciente || rowObj.Descripcion || '',
      monto: parseFloat(rowObj.Monto || rowObj.monto || rowObj.MONTO || 0),
      estado: rowObj.Estado || rowObj.estado || rowObj.ESTADO || '',
      idUnico: rowObj.ID_uNico || rowObj.idUnico || ''
    };
  });
  
  console.log('🔍 [DEBUG-READ] 7. Datos parseados:', datos.length);
  if (datos.length > 0) {
    console.log('🔍 [DEBUG-READ] 8. Primer dato:', JSON.stringify(datos[0]));
  }
  
  return datos;
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

bot.command('start', (ctx) => {
  ctx.reply(
    '👋 ¡Hola! Soy tu bot de cashflow.\n\n' +
    '📝 *Registrar movimiento:*\n' +
    '`alquiler [descripcion] $15000` (ingreso)\n' +
    '`alquiler [descripcion] $-500` (gasto)\n\n' +
    '✅ *Cobrar:*\n' +
    '`/cobrar ultimo` - Cobra el último pendiente\n\n' +
    '📊 *Reportes:*\n' +
    '`/caja` - Resumen de caja\n' +
    '`/turnos` - Movimientos de hoy\n' +
    '`/pendientes` - Sin cobrar\n\n' +
    '`/ayuda` - Ver todos los comandos',
    { parse_mode: 'Markdown' }
  );
});

bot.command('ayuda', (ctx) => {
  ctx.reply(
    '📖 *Comandos disponibles:*\n\n' +
    '📝 *Registrar movimiento:*\n' +
    '`alquiler [descripcion] $monto`\n' +
    'Ejemplo ingreso: `alquiler Juan Perez $15000`\n' +
    'Ejemplo gasto: `alquiler Compra materiales $-500`\n\n' +
    '✅ *Cobrar movimiento:*\n' +
    '`/cobrar ultimo` - Cobra el último pendiente\n' +
    '`/cobrar Juan` - Cobra uno que coincida\n\n' +
    '📊 *Reportes:*\n' +
    '`/caja` - Resumen de caja\n' +
    '`/turnos` - Movimientos de hoy\n' +
    '`/pendientes` - Movimientos sin cobrar\n' +
    '`/semana` - Resumen semanal\n' +
    '`/pacientes` - Lista de hoy\n\n' +
    '`/ayuda` - Este mensaje',
    { parse_mode: 'Markdown' }
  );
});

bot.command('caja', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet();
    
    console.log('🔍 [CAJA] Datos totales:', datos.length);
    console.log('🔍 [CAJA] Primer registro:', JSON.stringify(datos[0] || 'vacio'));
    
    const hoy = datos.filter(d => esHoy(d.fecha));
    console.log('🔍 [CAJA] Filtro hoy:', hoy.length);
    const semana = datos.filter(d => esEstaSemana(d.fecha));
    const mes = datos.filter(d => esEsteMes(d.fecha));
    
    const totalHoy = hoy.reduce((sum, d) => sum + d.monto, 0);
    const totalSemana = semana.reduce((sum, d) => sum + d.monto, 0);
    const totalMes = mes.reduce((sum, d) => sum + d.monto, 0);
    
    const pendientesHoy = hoy.filter(d => d.estado === 'Pendiente').length;
    const pendientesMes = mes.filter(d => d.estado === 'Pendiente').length;
    
    const msg = 
      `💰 *RESUMEN DE CAJA*\n\n` +
      `📅 *Hoy:* $${totalHoy.toLocaleString()}\n` +
      `   Turnos: ${hoy.length} | Pendientes: ${pendientesHoy}\n\n` +
      `📆 *Esta semana:* $${totalSemana.toLocaleString()}\n` +
      `   Turnos: ${semana.length}\n\n` +
      `📆 *Este mes:* $${totalMes.toLocaleString()}\n` +
      `   Turnos: ${mes.length} | Pendientes: ${pendientesMes}`;
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /caja:', error);
    ctx.reply('❌ Error al obtener datos');
  }
});

bot.command('turnos', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet();
    const hoy = datos.filter(d => esHoy(d.fecha));
    
    if (hoy.length === 0) {
      return ctx.reply('📭 No hay turnos registrados hoy.');
    }
    
    let msg = `📋 *TURNOS DE HOY*\n\n`;
    hoy.forEach((d, i) => {
      const emoji = d.estado === 'Cobrado' ? '✅' : '⏳';
      msg += `${emoji} ${d.hora} - ${d.paciente}\n`;
      msg += `   $${d.monto.toLocaleString()}\n\n`;
    });
    
    const total = hoy.reduce((sum, d) => sum + d.monto, 0);
    msg += `━━━━━━━━━━━━━━━\n`;
    msg += `💰 Total: $${total.toLocaleString()}`;
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /turnos:', error);
    ctx.reply('❌ Error al obtener datos');
  }
});

bot.command('pendientes', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet();
    const pendientes = datos.filter(d => d.estado === 'Pendiente');
    
    if (pendientes.length === 0) {
      return ctx.reply('✅ No hay turnos pendientes. ¡Todo cobrado!');
    }
    
    const pendientesHoy = pendientes.filter(d => esHoy(d.fecha));
    const pendientesAntiguos = pendientes.filter(d => !esHoy(d.fecha));
    
    let msg = `⏳ *TURNOS PENDIENTES*\n\n`;
    
    if (pendientesHoy.length > 0) {
      msg += `📅 *Hoy:*\n`;
      pendientesHoy.forEach(d => {
        msg += `• ${d.paciente} - $${d.monto.toLocaleString()}\n`;
      });
      msg += `\n`;
    }
    
    if (pendientesAntiguos.length > 0) {
      msg += `📆 *Anteriores:*\n`;
      pendientesAntiguos.slice(0, 10).forEach(d => {
        msg += `• ${d.paciente} - ${formatFecha(d.fecha)} - $${d.monto.toLocaleString()}\n`;
      });
      if (pendientesAntiguos.length > 10) {
        msg += `... y ${pendientesAntiguos.length - 10} más\n`;
      }
    }
    
    const totalPendiente = pendientes.reduce((sum, d) => sum + d.monto, 0);
    msg += `\n━━━━━━━━━━━━━━━\n`;
    msg += `💵 Total pendiente: $${totalPendiente.toLocaleString()}`;
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /pendientes:', error);
    ctx.reply('❌ Error al obtener datos');
  }
});

bot.command('semana', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet();
    const semana = datos.filter(d => esEstaSemana(d.fecha));
    
    if (semana.length === 0) {
      return ctx.reply('📭 No hay turnos esta semana.');
    }
    
    const total = semana.reduce((sum, d) => sum + d.monto, 0);
    const pendientes = semana.filter(d => d.estado === 'Pendiente');
    const cobrados = semana.filter(d => d.estado === 'Cobrado');
    const totalCobrado = cobrados.reduce((sum, d) => sum + d.monto, 0);
    const totalPendiente = pendientes.reduce((sum, d) => sum + d.monto, 0);
    
    const porDia = {};
    semana.forEach(d => {
      const fechaKey = formatFecha(d.fecha);
      if (!porDia[fechaKey]) {
        porDia[fechaKey] = { cantidad: 0, monto: 0 };
      }
      porDia[fechaKey].cantidad++;
      porDia[fechaKey].monto += d.monto;
    });
    
    let msg = `📊 *RESUMEN SEMANAL*\n`;
    msg += `━━━━━━━━━━━━━━━━━\n\n`;
    
    Object.keys(porDia).sort((a, b) => {
      const dateA = normalizarFecha(a);
      const dateB = normalizarFecha(b);
      return dateA - dateB;
    }).forEach(fecha => {
      const info = porDia[fecha];
      msg += `📅 ${fecha}: ${info.cantidad} turno(s) - $${info.monto.toLocaleString()}\n`;
    });
    
    msg += `\n━━━━━━━━━━━━━━━\n`;
    msg += `📋 Total turnos: ${semana.length}\n`;
    msg += `✅ Cobrados: ${cobrados.length} - $${totalCobrado.toLocaleString()}\n`;
    msg += `⏳ Pendientes: ${pendientes.length} - $${totalPendiente.toLocaleString()}\n\n`;
    msg += `💰 *Total general: $${total.toLocaleString()}*`;
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /semana:', error);
    ctx.reply('❌ Error al obtener datos');
  }
});

bot.command('pacientes', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet();
    const hoy = datos.filter(d => esHoy(d.fecha));
    
    if (hoy.length === 0) {
      return ctx.reply('📭 No hay movimientos hoy.');
    }
    
    const pacientesUnicos = [...new Set(hoy.map(d => d.paciente))];
    
    let msg = `👥 *MOVIMIENTOS DE HOY*\n\n`;
    hoy.forEach((d, i) => {
      const emoji = d.estado === 'Cobrado' ? '✅' : '⏳';
      const montoStr = d.monto < 0 ? `-$${Math.abs(d.monto).toLocaleString()}` : `$${d.monto.toLocaleString()}`;
      msg += `${emoji} ${d.paciente}\n`;
      msg += `   💰 ${montoStr} | ${d.hora}\n\n`;
    });
    
    msg += `━━━━━━━━━━━━━━━\n`;
    msg += `📊 ${hoy.length} movimiento(s)`;
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /pacientes:', error);
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
      const texto = ctx.message.text.replace('/cobrar', '').trim();
      filaActual = pendientes.find(f => 
        (f.Paciente || f.paciente || '').toLowerCase().includes(texto.toLowerCase())
      );
      if (!filaActual && texto) {
        filaActual = pendientes.find(f => 
          (f.ID_uNico || f.idUnico || '') === texto
        );
      }
    }
    
    if (!filaActual) {
      let msg = `⏳ *Movimientos pendientes:*\n\n`;
      pendientes.slice(-5).forEach((f, i) => {
        const monto = parseFloat(f.Monto || f.monto || 0);
        const montoStr = monto < 0 ? `-$${Math.abs(monto).toLocaleString()}` : `$${monto.toLocaleString()}`;
        msg += `• ${f.Paciente || f.paciente} - ${montoStr}\n`;
      });
      msg += `\nUsa: `/cobrar [nombre]` `;
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }
    
    filaActual.Estado = 'Cobrado';
    await filaActual.save();
    
    const monto = parseFloat(filaActual.Monto || filaActual.monto || 0);
    const montoStr = monto < 0 ? `-$${Math.abs(monto).toLocaleString()}` : `$${monto.toLocaleString()}`;
    
    ctx.reply(
      `✅ *¡Marcado como cobrado!*\n\n` +
      `📝 ${filaActual.Paciente || filaActual.paciente}\n` +
      `💰 ${montoStr}`,
      { parse_mode: 'Markdown' }
    );
    
  } catch (error) {
    console.error('Error /cobrar:', error);
    ctx.reply('❌ Error al actualizar estado.');
  }
});

const regexMsg = /^(?:alquiler\s+)?(.+?)\s+\$(-?\d+(?:\.\d{1,2})?)$/i;

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  
  if (text.startsWith('/')) return;
  
  const match = text.match(regexMsg);
  if (!match) {
    return ctx.reply(
      '⚠️ Formato no válido.\n\n' +
      'Usa: `alquiler [descripcion] $monto`\n' +
      'Ejemplo ingreso: `alquiler Juan Perez $15000`\n' +
      'Ejemplo gasto: `alquiler Luz $-500`\n\n' +
      'O prueba: `/ayuda`',
      { parse_mode: 'Markdown' }
    );
  }

  const paciente = match[1].trim();
  const amountStr = match[2];
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount === 0) {
    return ctx.reply('❌ Error: El monto no puede ser 0.');
  }

  try {
    await ctx.reply('⏳ Registrando...');
    
    console.log('🔍 [DEBUG] 1. Iniciando proceso de guardado...');
    
    await doc.loadInfo();
    console.log('🔍 [DEBUG] 2. Doc info cargada:', doc.title);
    
    const sheet = doc.sheetsByIndex[0];
    console.log('🔍 [DEBUG] 3. Sheet obtenido:', sheet.title);
    
    const now = new Date();
    const fechaStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
    const horaStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const idUnico = `turno_${Date.now()}`;
    
    const rowData = {
      'Fecha': fechaStr,
      'Hora': horaStr,
      'Paciente': paciente,
      'Monto': amount,
      'Estado': 'Pendiente',
      'ID_uNico': idUnico
    };
    
    console.log('🔍 [DEBUG] 4. Datos a guardar:', JSON.stringify(rowData, null, 2));
    
    const result = await sheet.addRow(rowData);
    console.log('✅ [DEBUG] 5. Fila guardada! Resultado:', result);

    const tipoTexto = amount < 0 ? 'Gasto' : 'Ingreso';
    const tipoEmoji = amount < 0 ? '💸' : '💰';
    const montoFormateado = amount < 0 ? `-$${Math.abs(amount).toLocaleString()}` : `$${amount.toLocaleString()}`;

    ctx.reply(
      `${tipoEmoji} *¡${tipoTexto} registrado!*\n\n` +
      `📝 Descripción: ${paciente}\n` +
      `💰 Monto: ${montoFormateado}\n` +
      `📅 Fecha: ${fechaStr}\n` +
      `🕐 Hora: ${horaStr}\n` +
      `📌 Estado: Pendiente`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('❌ [DEBUG] Error al guardar:', error);
    console.error('❌ [DEBUG] Error message:', error.message);
    console.error('❌ [DEBUG] Error response:', error.response?.data);
    ctx.reply('❌ Error al guardar en Google Sheets.');
  }
});

bot.launch().then(() => {
  console.log('✅ Bot iniciado y escuchando...');
}).catch(err => {
  console.error('❌ Error al iniciar:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
