require('dotenv').config();
const { Telegraf } = require('telegraf');
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

let cotizacionDolar = null;
let cotizacionFecha = null;

const BOT_TOKEN = process.env.BOT_TOKEN;
const AUTHORIZED_USER_ID = process.env.AUTHORIZED_USER_ID ? parseInt(process.env.AUTHORIZED_USER_ID, 10) : null;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';
const COTIZACION_DEFAULT = process.env.COTIZACION_DEFAULT ? parseFloat(process.env.COTIZACION_DEFAULT) : null;
const ALLOWED_EMAILS = process.env.ALLOWED_EMAILS ? process.env.ALLOWED_EMAILS.split(',').map(e => e.trim().toLowerCase()) : [];
const MAX_INTENTOS_EMAIL = 3;

const CLIENTES_FILE = path.join(__dirname, 'clientes.json');

function esEmailAutorizado(email) {
  if (!email) return false;
  return ALLOWED_EMAILS.includes(email.toLowerCase().trim());
}

function getIntentosEmail(userId) {
  return pendingIntentosEmail.get(userId) || 0;
}

function incrementIntentosEmail(userId) {
  const actuales = getIntentosEmail(userId);
  pendingIntentosEmail.set(userId, actuales + 1);
  return actuales + 1;
}

function resetIntentosEmail(userId) {
  pendingIntentosEmail.delete(userId);
}

function cargarClientes() {
  try {
    if (fs.existsSync(CLIENTES_FILE)) {
      const data = fs.readFileSync(CLIENTES_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error al cargar clientes:', error.message);
  }
  return {};
}

function guardarClientes(clientes) {
  try {
    fs.writeFileSync(CLIENTES_FILE, JSON.stringify(clientes, null, 2));
  } catch (error) {
    console.error('Error al guardar clientes:', error.message);
  }
}

let clientes = cargarClientes();
console.log('Clientes cargados:', Object.keys(clientes).length);

function esAdminOriginal(userId) {
  return AUTHORIZED_USER_ID && userId === AUTHORIZED_USER_ID;
}

function obtenerClientePorUserId(userId) {
  for (const [ownerId, cliente] of Object.entries(clientes)) {
    if (parseInt(ownerId) === userId) return { userId: ownerId, ownerId: null, ...cliente };
    if (cliente.usuarios && cliente.usuarios.includes(userId)) {
      return { userId: ownerId, ownerId: ownerId, ...cliente };
    }
  }
  return null;
}

function getSheetId(userId) {
  const cliente = obtenerClientePorUserId(userId);
  if (cliente && cliente.sheetId) return cliente.sheetId;
  if (esAdminOriginal(userId) && SPREADSHEET_ID) return SPREADSHEET_ID;
  return null;
}

const pendingRegistros = new Map();
const pendingCodigos = new Map();

if (COTIZACION_DEFAULT) {
  cotizacionDolar = COTIZACION_DEFAULT;
  cotizacionFecha = new Date();
  console.log(`Usando cotización default: ${cotizacionDolar}`);
}

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
const pendingIntentosEmail = new Map();

const METODOS_VALIDOS = ['efectivo', 'transferencia', 'tarjeta'];
const COMANDOS_INGRESO = ['consulta', 'servicio'];
const COMANDOS_EGRESO = ['gasto'];

const pendingDeletes = new Map();
const pendingEdits = new Map();
const pendingCotizaciones = new Map();
const pendingLimpiezas = new Map();
const docsCache = new Map();

async function obtenerCotizacionDolar() {
  try {
    console.log('Obteniendo cotización de Bluelytics...');
    const response = await axios.get('https://api.bluelytics.com.ar/v2/latest', { timeout: 10000 });
    cotizacionDolar = response.data.blue.value_avg;
    cotizacionFecha = new Date();
    console.log(`Cotización dólar (Bluelytics): $${cotizacionDolar} - Fecha: ${cotizacionFecha}`);
    return cotizacionDolar;
  } catch (error) {
    console.error('Error al obtener cotización Bluelytics:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
    return null;
  }
}

function convertirAPesos(monto, moneda) {
  if (moneda === 'Dólares' && cotizacionDolar) {
    return Math.round(monto * cotizacionDolar * 100) / 100;
  }
  return monto;
}

function sanitizarInput(texto, maxLength = 200) {
  if (!texto || typeof texto !== 'string') return '';
  return texto.slice(0, maxLength).replace(/[<>\"'&]/g, '').trim();
}

function esMonedaValida(moneda) {
  return ['$', 'U$', 'USD'].includes(moneda);
}

bot.use((ctx, next) => {
  const userId = ctx.from.id;

  if (esAdminOriginal(userId)) {
    return next();
  }

  const cliente = obtenerClientePorUserId(userId);
  if (cliente) {
    return next();
  }

  if (ctx.from) {
    console.log(`Usuario no registrado: ${userId}`);
  }
  return next();
});

async function obtenerDatosSheet(userId) {
  const sheetId = getSheetId(userId);
  if (!sheetId) {
    console.error('No se encontró sheetId para userId:', userId);
    return [];
  }

  invalidateCache(userId);
  const docCliente = await getDocCliente(userId, true);
  const sheet = docCliente.sheetsByIndex[0];
  await sheet.loadCells();
  const filas = await sheet.getRows();

  const datos = filas.map(row => {
    const rowObj = row.toObject ? row.toObject() : row;
    return {
      fecha: rowObj.Fecha || rowObj.fecha || '',
      hora: rowObj.Hora || rowObj.hora || '',
      descripcion: rowObj.Descripcion || rowObj.descripcion || rowObj.Paciente || '',
      monto: parseFloat(rowObj.Monto || rowObj.monto || 0),
      montoPesos: parseFloat(rowObj.MontoPesos || rowObj.montopesos || rowObj.Monto || rowObj.monto || 0),
      estado: rowObj.Estado || rowObj.estado || '',
      tipo: rowObj.Tipo || rowObj.tipo || '',
      moneda: rowObj.Moneda || rowObj.moneda || 'Pesos',
      metodoPago: rowObj.MetodoPago || rowObj.metodopago || '',
      idUnico: rowObj.ID_unico || rowObj.ID_uNico || rowObj.idunico || ''
    };
  });

  return datos.filter(d => 
    d.fecha && d.fecha.trim() !== '' &&
    d.descripcion && d.descripcion.trim() !== '' &&
    d.monto && d.monto !== 0
  );
}

async function getDocCliente(userId, fresh = false) {
  const sheetId = getSheetId(userId);
  if (!sheetId) return null;
  
  if (fresh || !docsCache.has(userId)) {
    const docCliente = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await docCliente.loadInfo();
    docsCache.set(userId, docCliente);
  }
  
  return docsCache.get(userId);
}

function invalidateCache(userId) {
  docsCache.delete(userId);
}

async function getSheetCliente(userId) {
  const docCliente = await getDocCliente(userId, true);
  if (!docCliente) return null;
  const sheet = docCliente.sheetsByIndex[0];
  await sheet.loadCells();
  return sheet;
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

function generarIDUnico() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `mov_${timestamp}_${random}`;
}

function formatMonto(monto, moneda) {
  const monedaSimbolo = moneda === 'Dólares' ? 'U$' : '$';
  const montoAbs = Math.abs(monto);
  return monto < 0 ? `-${monedaSimbolo}${montoAbs.toLocaleString()}` : `${monedaSimbolo}${montoAbs.toLocaleString()}`;
}

bot.command('start', (ctx) => {
  const userId = ctx.from.id;

  if (esAdminOriginal(userId)) {
    return ctx.reply(
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
  }

  const cliente = obtenerClientePorUserId(userId);
  if (cliente) {
    return ctx.reply(
      '👋 ¡Bienvenido de nuevo a tu bot de cashflow!\n\n' +
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
  }

  pendingRegistros.set(userId, { step: 'email' });
  resetIntentosEmail(userId);
  ctx.reply(
    '📧 *Verificación de email*\n\n' +
    'Ingresa tu email corporativo:\n' +
    'Ejemplo: `juan@tuempresa.com`\n\n' +
    'Solo emails autorizados pueden registrarse.\n' +
    'O usa /cancelar para salir.'
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
    '`/cobrar [nombre]` - Cobra uno que coincida\n\n' +
    '✏️ *Editar:*\n' +
    '`/editar [nombre]` - Editar descripción y monto\n\n' +
    '🗑️ *Eliminar:*\n' +
    '`/eliminar [nombre]` - Eliminar movimiento\n' +
    '`/listar` - Ver todos los movimientos\n\n' +
    '💵 *Dólar:*\n' +
    '`/dolar` - Ver cotización actual\n' +
    '`/actualizardolar` - Actualizar cotización',
    { parse_mode: 'Markdown' }
  );
});

bot.command('balance', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet(ctx.from.id);

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
    const datos = await obtenerDatosSheet(ctx.from.id);
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
    const datos = await obtenerDatosSheet(ctx.from.id);
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
    const datos = await obtenerDatosSheet(ctx.from.id);
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

bot.command('debug', async (ctx) => {
  try {
    await ctx.reply('🔍 *DIAGNÓSTICO DEL SISTEMA*\n\n⏳ Analizando...');

    const userId = ctx.from.id;
    const sheetId = getSheetId(userId);

    if (!sheetId) {
      return ctx.reply('❌ No tienes un Sheet configurado. Usa /start.');
    }

    const datosRaw = await obtenerDatosSheet(userId);
    const totalFilas = datosRaw.length;

    const conFecha = datosRaw.filter(d => d.fecha && d.fecha.trim() !== '');
    const conDescripcion = datosRaw.filter(d => d.descripcion && d.descripcion.trim() !== '');
    const conMonto = datosRaw.filter(d => d.monto && d.monto !== 0);
    const filasValidas = datosRaw.filter(d => 
      d.fecha && d.fecha.trim() !== '' &&
      d.descripcion && d.descripcion.trim() !== '' &&
      d.monto && d.monto !== 0
    );

    const mes = filasValidas.filter(d => esEsteMes(d.fecha));
    const hoy = filasValidas.filter(d => esHoy(d.fecha));

    let msg = `🔍 *DIAGNÓSTICO*\n\n`;
    msg += `📄 *Sheet ID:* \`${sheetId}\`\n`;
    msg += `👤 *User ID:* ${userId}\n\n`;
    msg += `📊 *ESTADÍSTICAS DE FILAS*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Total filas leídas: ${totalFilas}\n`;
    msg += `Con fecha: ${conFecha.length}\n`;
    msg += `Con descripción: ${conDescripcion.length}\n`;
    msg += `Con monto válido: ${conMonto.length}\n`;
    msg += `✅ *Filas válidas (con todo): ${filasValidas.length}*\n\n`;
    msg += `📅 *DEL MES ACTUAL*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Movimientos: ${mes.length}\n`;
    msg += `Total: $${mes.reduce((sum, d) => sum + d.monto, 0).toLocaleString()}\n\n`;
    msg += `📆 *HOY*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Movimientos: ${hoy.length}\n`;
    msg += `Total: $${hoy.reduce((sum, d) => sum + d.monto, 0).toLocaleString()}`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });

    const analisisMensual = {};
    filasValidas.forEach(d => {
      const fecha = normalizarFecha(d.fecha);
      if (fecha) {
        const clave = `${fecha.getFullYear()}-${(fecha.getMonth() + 1).toString().padStart(2, '0')}`;
        if (!analisisMensual[clave]) {
          analisisMensual[clave] = { count: 0, total: 0 };
        }
        analisisMensual[clave].count++;
        analisisMensual[clave].total += d.monto;
      }
    });

    if (Object.keys(analisisMensual).length > 0) {
      let msg2 = `📅 *ANÁLISIS POR MES*\n`;
      msg2 += `━━━━━━━━━━━━━━━━━━━━\n`;
      
      const mesesOrdenados = Object.keys(analisisMensual).sort().reverse();
      mesesOrdenados.forEach(mes => {
        const [anio, mesNum] = mes.split('-');
        const nombresMeses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                              'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const nombreMes = nombresMeses[parseInt(mesNum) - 1];
        const datos = analisisMensual[mes];
        const esMesActual = mes === `${new Date().getFullYear()}-${(new Date().getMonth() + 1).toString().padStart(2, '0')}`;
        
        msg2 += `\n📆 ${nombreMes} ${anio}${esMesActual ? ' *(MES ACTUAL)*' : ''}\n`;
        msg2 += `   Movimientos: ${datos.count}\n`;
        msg2 += `   Total: $${datos.total.toLocaleString()}`;
      });
      
      await ctx.reply(msg2, { parse_mode: 'Markdown' });
    }

    if (filasValidas.length > 0) {
      let msg3 = `📋 *TODOS LOS MOVIMIENTOS*\n`;
      msg3 += `━━━━━━━━━━━━━━━━━━━━\n`;
      msg3 += `(${filasValidas.length} movimientos en total)\n\n`;
      
      const hoy = new Date();
      filasValidas.forEach((d, i) => {
        const fecha = normalizarFecha(d.fecha);
        const esDeEsteMes = fecha && esEsteMes(d.fecha);
        const marker = esDeEsteMes ? '✅' : '📅';
        
        msg3 += `${marker} ${i + 1}. ${d.descripcion.substring(0, 40)}\n`;
        msg3 += `   💰 ${formatMonto(d.monto, d.moneda)} | ${d.fecha}\n`;
        if (i < filasValidas.length - 1) msg3 += '\n';
      });
      
      await ctx.reply(msg3, { parse_mode: 'Markdown' });
    }

    if (totalFilas > filasValidas.length) {
      const filasInvalidas = totalFilas - filasValidas.length;
      let msg4 = `⚠️ *FILAS INVÁLIDAS ENCONTRADAS*\n`;
      msg4 += `━━━━━━━━━━━━━━━━━━━━\n`;
      msg4 += `Hay ${filasInvalidas} filas que no tienen todos los datos necesarios.\n\n`;
      msg4 += `💡 *Solución:* Usa /limpiar para eliminar estas filas del Sheet.`;
      await ctx.reply(msg4, { parse_mode: 'Markdown' });
    }

  } catch (error) {
    console.error('Error /debug:', error.message, error.stack);
    await ctx.reply('❌ Error en el diagnóstico. Revisa los logs.');
  }
});

bot.command('limpiar', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const sheetId = getSheetId(userId);

    if (!sheetId) {
      return ctx.reply('❌ No tienes un Sheet configurado. Usa /start.');
    }

    await ctx.reply('🧹 *LIMPIEZA DEL SHEET*\n\n⏳ Analizando filas...');

    const sheet = await getSheetCliente(userId);
    const filasRaw = await sheet.getRows();
    const totalFilas = filasRaw.length;

    const filasInvalidas = [];
    
    filasRaw.forEach((fila, index) => {
      const rowObj = fila.toObject ? fila.toObject() : fila;
      const fecha = rowObj.Fecha || rowObj.fecha || '';
      const descripcion = rowObj.Descripcion || rowObj.descripcion || rowObj.Paciente || '';
      const monto = parseFloat(rowObj.Monto || rowObj.monto || 0);

      const esValida = fecha && fecha.trim() !== '' && 
                      descripcion && descripcion.trim() !== '' && 
                      monto && monto !== 0;

      if (!esValida) {
        filasInvalidas.push({ fila, index });
      }
    });

    if (filasInvalidas.length === 0) {
      return ctx.reply('✅ *¡Todo limpio!*\n\nNo hay filas inválidas en tu Sheet.');
    }

    pendingLimpiezas.set(userId, { filas: filasInvalidas, sheet });

    let msg = `🧹 *FILAS A ELIMINAR*\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📊 Total filas: ${totalFilas}\n`;
    msg += `❌ Filas inválidas: ${filasInvalidas.length}\n\n`;
    msg += `*Detalles:*\n`;

    if (filasInvalidas.length <= 10) {
      filasInvalidas.forEach((item, i) => {
        const rowObj = item.fila.toObject ? item.fila.toObject() : item.fila;
        const fecha = rowObj.Fecha || rowObj.fecha || '(vacía)';
        const desc = rowObj.Descripcion || rowObj.descripcion || rowObj.Paciente || '(vacía)';
        const monto = rowObj.Monto || rowObj.monto || '0';
        msg += `\n${i + 1}. Fila #${item.index + 1}\n`;
        msg += `   📅: ${fecha} | 💰: $${monto}\n`;
        msg += `   📝: ${desc.substring(0, 50)}`;
      });
    } else {
      msg += `Primeras 5:\n`;
      filasInvalidas.slice(0, 5).forEach((item, i) => {
        msg += `${i + 1}. Fila #${item.index + 1}\n`;
      });
      msg += `\n...y ${filasInvalidas.length - 5} más`;
    }

    msg += `\n\n⚠️ *¿Confirmas la eliminación?*\n`;
    msg += `Responde *sí* para eliminar o *no* para cancelar.`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error /limpiar:', error.message, error.stack);
    await ctx.reply('❌ Error al analizar el Sheet. Revisa los logs.');
  }
});

bot.command('mes', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando...');
    const datos = await obtenerDatosSheet(ctx.from.id);
    const mes = datos.filter(d => esEsteMes(d.fecha));

    if (mes.length === 0) {
      return ctx.reply('📭 No hay movimientos este mes. :(');
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
    const datos = await obtenerDatosSheet(ctx.from.id);
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
    const datos = await obtenerDatosSheet(ctx.from.id);
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

    const sheet = await getSheetCliente(ctx.from.id);
    if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');
    const filas = await sheet.getRows();

    const pendientes = filas.filter(f => (f.get('Estado') || f.get('estado')) === 'Pendiente');

    if (pendientes.length === 0) {
      return ctx.reply('✅ No hay movimientos pendientes.');
    }

    let filaActual = null;

    if (args.length > 0 && args[0] === 'ultimo') {
      filaActual = pendientes[pendientes.length - 1];
    } else {
      const texto = ctx.message.text.replace('/cobrar', '').trim().toLowerCase();
      filaActual = pendientes.find(f =>
        (f.get('Descripcion') || f.get('descripcion') || '').toLowerCase().includes(texto)
      );
      if (!filaActual && texto) {
        filaActual = pendientes.find(f =>
          (f.get('ID_uNico') || f.get('idunico') || '') === texto
        );
      }
    }

    if (!filaActual) {
      let msg = `⏳ *Movimientos pendientes:*\n\n`;
      pendientes.slice(-5).forEach((f, i) => {
        msg += `• ${f.get('Descripcion') || f.get('descripcion')}\n`;
      });
      msg += `\nUsa: /cobrar [nombre]`;
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    filaActual.set('Estado', 'Cobrado');
    await filaActual.save();

    ctx.reply(
      `✅ *¡Marcado como cobrado!*\n\n` +
      `📝 ${filaActual.get('Descripcion') || filaActual.get('descripcion')}`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Error /cobrar:', error.message);
    ctx.reply('❌ Error al actualizar estado.');
  }
});

bot.command('eliminar', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1);

    if (args.length === 0) {
      return ctx.reply('⚠️ Uso: /eliminar [ID o nombre]\n\nEjemplo: /eliminar consulta Juan');
    }

    const texto = ctx.message.text.replace('/eliminar', '').trim().toLowerCase();
    console.log('DEBUG /eliminar - Buscando:', texto);

    const sheet = await getSheetCliente(ctx.from.id);
    if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');
    const filas = await sheet.getRows();

    console.log('DEBUG /eliminar - Total filas:', filas.length);
    
    if (filas.length > 0) {
      const primeraFila = filas[0].toObject ? filas[0].toObject() : filas[0];
      console.log('DEBUG /eliminar - Columnas disponibles:', Object.keys(primeraFila));
      console.log('DEBUG /eliminar - Primera fila:', primeraFila);
    }

    let filaActual = null;
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

      console.log(`DEBUG /eliminar - Fila ${index}: desc="${desc}", id="${id}"`);

      if (id === texto || desc.includes(texto)) {
        console.log(`DEBUG /eliminar - ¡COINCIDENCIA en fila ${index}!`);
        coincidencias.push({ fila: f, index });
      }
    });

    console.log('DEBUG /eliminar - Coincidencias encontradas:', coincidencias.length);

    if (coincidencias.length === 0) {
      let msg = '❌ No se encontró ningún movimiento con ese nombre o ID.\n\n';
      msg += '📋 *Últimos 5 movimientos:*\n\n';
      
      const ultimosMovimientos = filas.slice(-5).reverse();
      ultimosMovimientos.forEach((f, i) => {
        const desc = f.get('Descripcion') || f.get('descripcion') || f.get('Paciente') || f.get('paciente') || f.get('Nombre') || f.get('nombre') || 'Sin descripción';
        const monto = f.get('Monto') || f.get('monto') || '0';
        const fecha = f.get('Fecha') || f.get('fecha') || '';
        msg += `${i + 1}. ${desc}\n`;
        msg += `   $${monto} - ${fecha}\n\n`;
      });
      
      msg += '💡 *Tip:* Intenta copiar parte del nombre exacto de arriba.';
      
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    if (coincidencias.length > 1) {
      let msg = `⚠️ *Varias coincidencias (${coincidencias.length}):*\n\n`;
      coincidencias.slice(0, 5).forEach((c, i) => {
        const f = c.fila;
        const desc = f.get('Descripcion') || f.get('descripcion') || f.get('Paciente') || f.get('paciente') || f.get('Nombre') || f.get('nombre') || 'Sin descripción';
        msg += `${i + 1}. ${desc}\n`;
        msg += `   ${formatMonto(parseFloat(f.get('Monto') || f.get('monto') || 0), f.get('Moneda') || f.get('moneda') || 'Pesos')} - ${f.get('Fecha') || f.get('fecha')}\n\n`;
      });
      msg += `\nEspecificá mejor el nombre o usa /listar para ver todos.`;
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    filaActual = coincidencias[0].fila;

    const monto = parseFloat(filaActual.get('Monto') || filaActual.get('monto') || 0);
    const moneda = filaActual.get('Moneda') || filaActual.get('moneda') || 'Pesos';
    const desc = filaActual.get('Descripcion') || filaActual.get('descripcion') || filaActual.get('Paciente') || filaActual.get('paciente') || filaActual.get('Nombre') || filaActual.get('nombre') || 'Sin descripción';
    const id = filaActual.get('ID_Unico') || filaActual.get('ID_unico') || filaActual.get('ID_uNico') || filaActual.get('idunico') || 'sin-id';
    const fecha = filaActual.get('Fecha') || filaActual.get('fecha') || 'N/A';
    const hora = filaActual.get('Hora') || filaActual.get('hora') || 'N/A';
    const tipo = filaActual.get('Tipo') || filaActual.get('tipo') || 'N/A';
    const metodo = filaActual.get('MetodoPago') || filaActual.get('metodopago') || 'N/A';
    const estado = filaActual.get('Estado') || filaActual.get('estado') || 'N/A';

    pendingDeletes.set(ctx.from.id, { 
      fila: filaActual,
      index: coincidencias[0].index,
      sheet, 
      desc, 
      monto, 
      moneda, 
      id,
      fecha,
      hora,
      tipo,
      metodo,
      estado
    });

    let msg = `⚠️ *¿ELIMINAR ESTE MOVIMIENTO?*\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📝 ${desc}\n`;
    msg += `💰 ${formatMonto(monto, moneda)}\n`;
    msg += `📅 ${fecha} ${hora}\n`;
    msg += `🏷️ Tipo: ${tipo}\n`;
    msg += `💳 Método: ${metodo}\n`;
    msg += `📊 Estado: ${estado}\n`;
    msg += `🆔 ${id}\n`;
    msg += `📄 Fila: #${coincidencias[0].index + 1} del Sheet\n\n`;
    msg += `⚠️ *¿Confirmas la eliminación?*\n`;
    msg += `Responde *sí* para confirmar o *no* para cancelar.`;

    ctx.reply(msg, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error /eliminar:', error.message, error.stack);
    ctx.reply('❌ Error al buscar movimiento. Verifica los logs.');
  }
});

bot.command('listar', async (ctx) => {
  try {
    await ctx.reply('⏳ Cargando movimientos...');
    
    const sheet = await getSheetCliente(ctx.from.id);
    if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');
    
    const filas = await sheet.getRows();
    
    console.log('DEBUG /listar - Total filas:', filas.length);
    
    if (filas.length === 0) {
      return ctx.reply('📭 No hay movimientos en el sheet.');
    }
    
    if (filas.length > 0) {
      const primeraFila = filas[0].toObject ? filas[0].toObject() : filas[0];
      console.log('DEBUG /listar - Columnas:', Object.keys(primeraFila));
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
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /listar:', error.message, error.stack);
    ctx.reply('❌ Error al listar movimientos. Verifica los logs.');
  }
});

bot.command('regenerar_ids', async (ctx) => {
  try {
    await ctx.reply('🔄 Buscando filas sin ID...');
    
    const sheet = await getSheetCliente(ctx.from.id);
    if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');
    
    const filas = await sheet.getRows();
    
    let actualizados = 0;
    let yaTenianId = 0;
    
    for (let i = 0; i < filas.length; i++) {
      const f = filas[i];
      
      const idActual = f.get('ID_Unico') || f.get('ID_unico') || '';
      
      if (!idActual || idActual === 'undefined' || idActual === 'null' || idActual.trim() === '') {
        const nuevoId = generarIDUnico();
        f.set('ID_Unico', nuevoId);
        await f.save();
        actualizados++;
        console.log(`✅ Fila ${i + 1}: ID guardado -> ${nuevoId}`);
      } else {
        yaTenianId++;
      }
    }
    
    let msg = `✨ *Regeneración de IDs completada*\n\n`;
    msg += `📊 *Resumen:*\n`;
    msg += `• IDs generados: ${actualizados}\n`;
    msg += `• Ya tenían ID: ${yaTenianId}\n`;
    msg += `• Total filas: ${filas.length}\n\n`;
    
    if (actualizados > 0) {
      msg += `✅ Los ${actualizados} movimientos ahora tienen ID único.\n`;
      msg += `Usa /listar para verificarlos.`;
    } else {
      msg += `💡 Todos los movimientos ya tenían ID.`;
    }
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error /regenerar_ids:', error.message, error.stack);
    ctx.reply('❌ Error al regenerar IDs. Verifica los logs.');
  }
});

bot.command('editar', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1);

    if (args.length === 0) {
      return ctx.reply(
        `📝 *Editar movimiento*\n\n` +
        `Uso: /editar [ID o nombre]\n\n` +
        `Podrás modificar:\n` +
        `• Descripción\n` +
        `• Monto\n\n` +
        `Ejemplo: /editar consulta Juan`
      );
    }

    const texto = ctx.message.text.replace('/editar', '').trim().toLowerCase();
    console.log('DEBUG /editar - buscando:', texto);

    const sheet = await getSheetCliente(ctx.from.id);
    if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');
    const filas = await sheet.getRows();
    console.log('DEBUG /editar - filas encontradas:', filas.length);

    let filaActual = null;
    const coincidencias = [];

    filas.forEach((f) => {
      const desc = (f.get('Descripcion') || f.get('descripcion') || '').toLowerCase();
      const id = (f.get('ID_Unico') || f.get('ID_unico') || f.get('ID_uNico') || f.get('idunico') || '').toLowerCase();

      if (id === texto || desc.includes(texto)) {
        coincidencias.push(f);
      }
    });

    console.log('DEBUG /editar - coincidencias:', coincidencias.length);

    if (coincidencias.length === 0) {
      return ctx.reply('❌ No se encontró ningún movimiento.');
    }

    if (coincidencias.length > 1) {
      let msg = `⚠️ *Varias coincidencias:*\n\n`;
      coincidencias.slice(0, 5).forEach((c, i) => {
        msg += `${i + 1}. ${c.get('Descripcion') || c.get('descripcion')}\n`;
        msg += `   ${formatMonto(parseFloat(c.get('Monto') || c.get('monto') || 0), c.get('Moneda') || c.get('moneda') || 'Pesos')} - ${c.get('Fecha') || c.get('fecha')}\n\n`;
      });
      msg += `\nEspecificá mejor: /editar [ID completo]`;
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    filaActual = coincidencias[0];

    const montoActual = parseFloat(filaActual.get('Monto') || filaActual.get('monto') || 0);
    const moneda = filaActual.get('Moneda') || filaActual.get('moneda') || 'Pesos';
    const descripcionActual = filaActual.get('Descripcion') || filaActual.get('descripcion') || '';
    const tipo = filaActual.get('Tipo') || filaActual.get('tipo') || 'Ingreso';

    pendingEdits.set(ctx.from.id, {
      fila: filaActual,
      descripcionOriginal: descripcionActual,
      descripcion: descripcionActual,
      montoOriginal: montoActual,
      nuevoMonto: montoActual,
      moneda,
      tipo,
      step: 'descripcion'
    });

    ctx.reply(
      `📝 *Editar movimiento*\n\n` +
      `📝 Descripción actual: *${descripcionActual}*\n\n` +
      'Escribí la nueva descripción (o enviai "- -" para mantener la actual)',
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Error /editar:', error.message);
    ctx.reply('❌ Error al buscar movimiento.');
  }
});

const regexMsg = /^(consulta|servicio|gasto)\s+(.+?)\s+(?:\$|U\$|USD)?\s*(-?\d+(?:\.\d{1,2})?)\s*((?:efectivo|transferencia|tarjeta))?$/i;

bot.command('reiniciar', async (ctx) => {
  const userId = ctx.from.id;

  if (!esAdminOriginal(userId)) {
    return ctx.reply('⚠️ Solo el owner puede usar este comando.');
  }

  const cliente = obtenerClientePorUserId(userId);
  delete clientes[userId];
  guardarClientes(clientes);

  if (cliente && cliente.sheetId) {
    try {
      const docToClear = new GoogleSpreadsheet(cliente.sheetId, serviceAccountAuth);
      await docToClear.loadInfo();
      const sheetToClear = docToClear.sheetsByIndex[0];
      const rows = await sheetToClear.getRows();
      for (const row of rows) {
        await row.delete();
      }
      ctx.reply('✅ Listo. usa /start');
    } catch (error) {
      console.error('Error sheet:', error.message);
      ctx.reply('✅ Datos borrados. usa /start');
    }
  } else {
    ctx.reply('✅ Listo. usa /start');
  }
});

const pendingReinicios = new Map();

const CODIGO_EXPIRACION_HORAS = 24;

bot.command('cancelar', (ctx) => {
  const userId = ctx.from.id;
  pendingRegistros.delete(userId);
  pendingDeletes.delete(userId);
  pendingEdits.delete(userId);
  pendingCotizaciones.delete(userId);
  pendingIntentosEmail.delete(userId);
  pendingReinicios.delete(userId);
  ctx.reply('❌ Proceso cancelado.');
});

bot.command('codigo', (ctx) => {
  const userId = ctx.from.id;

  if (esAdminOriginal(userId)) {
    const codigo = generateInviteCode();
    pendingCodigos.set(codigo, {
      ownerId: userId,
      createdAt: Date.now()
    });

    ctx.reply(
      `🔑 *Código de invitación*\n\n` +
      `Comparte este código (vigencia ${CODIGO_EXPIRACION_HORAS}h):\n\n` +
      `*${codigo}*\n\n` +
      `La persona debe usar /start y luego ingresar el código.`,
      { parse_mode: 'Markdown' }
    );
  } else {
    const cliente = obtenerClientePorUserId(userId);
    if (!cliente) {
      return ctx.reply('⚠️ No tienes una cuenta registrada.');
    }

    const ownerId = parseInt(cliente.ownerId);

    if (ownerId !== userId) {
      return ctx.reply('⚠️ Solo el owner puede generar códigos de invitación.');
    }

    const codigo = generateInviteCode();
    pendingCodigos.set(codigo, {
      ownerId: ownerId,
      createdAt: Date.now()
    });

    ctx.reply(
      `🔑 *Código de invitación*\n\n` +
      `Comparte este código (vigencia ${CODIGO_EXPIRACION_HORAS}h):\n\n` +
      `*${codigo}*\n\n` +
      `La persona debe usar /start y luego ingresar el código.`,
      { parse_mode: 'Markdown' }
    );
  }
});

bot.command('unir', (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ').slice(1);

  if (obtenerClientePorUserId(userId)) {
    return ctx.reply('⚠️ Ya tienes una cuenta registrada. Habla con el owner si necesitas agregar otro usuario.');
  }

  if (args.length === 0) {
    return ctx.reply('⚠️ Uso: /unir [código]\n\nEjemplo: /unir ABC123');
  }

  const codigo = args[0].toUpperCase();
  const codigoData = pendingCodigos.get(codigo);

  if (!codigoData) {
    return ctx.reply('❌ Código inválido o expirado. Pide uno nuevo al owner.');
  }

  const ownerId = codigoData.ownerId;
  if (!clientes[ownerId]) {
    pendingCodigos.delete(codigo);
    return ctx.reply('❌ El owner ya no existe.');
  }

  if (!clientes[ownerId].usuarios) {
    clientes[ownerId].usuarios = [];
  }

  if (clientes[ownerId].usuarios.includes(userId)) {
    return ctx.reply('⚠️ Ya estás autorizado en esta cuenta.');
  }

  clientes[ownerId].usuarios.push(userId);
  guardarClientes(clientes);
  pendingCodigos.delete(codigo);

  ctx.reply(
    `✅ *¡Te uniste correctamente!*\n\n` +
    `Ahora puedes usar el bot con la cuenta del owner.\n` +
    `Usa /start para ver los comandos disponibles.`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('misusuarios', (ctx) => {
  const userId = ctx.from.id;
  const cliente = obtenerClientePorUserId(userId);

  if (!cliente) {
    return ctx.reply('⚠️ No tienes una cuenta registrada.');
  }

  const ownerId = parseInt(cliente.ownerId);
  if (ownerId !== userId) {
    return ctx.reply('⚠️ Solo el owner puede ver la lista de usuarios.');
  }

  const ownerCliente = clientes[ownerId];
  const usuarios = ownerCliente.usuarios || [];

  if (usuarios.length === 0) {
    return ctx.reply('👥 No hay usuarios adicionales autorizados.\n\nUsa /codigo para generar uno.');
  }

  let msg = `👥 *Usuarios autorizados:*\n\n`;
  usuarios.forEach((uid, i) => {
    msg += `${i + 1}. Usuario ID: ${uid}\n`;
  });
  msg += `\nUsa /codigo para agregar más.`;

  ctx.reply(msg, { parse_mode: 'Markdown' });
});

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;

  if (text.startsWith('/')) return;

  if (pendingReinicios.has(userId)) {
    const respuesta = text.toLowerCase().trim();
    if (respuesta === 'sí' || respuesta === 'si' || respuesta === 's' || respuesta === 'yes' || respuesta === 'y') {
      const cliente = obtenerClientePorUserId(userId);

      delete clientes[userId];
      guardarClientes(clientes);

      if (cliente && cliente.sheetId) {
        try {
          const docToClear = new GoogleSpreadsheet(cliente.sheetId, serviceAccountAuth);
          await docToClear.loadInfo();
          const sheetToClear = docToClear.sheetsByIndex[0];
          const rows = await sheetToClear.getRows();
          for (const row of rows) {
            await row.delete();
          }
          ctx.reply(
            '✅ *Registro reiniciado*\n\n' +
            'Se borraron:\n' +
            '• Tus datos locales\n' +
            '• Todos los movimientos del sheet\n\n' +
            'Usa /start para registrarte de nuevo.',
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.error('Error al limpiar sheet:', error.message);
          ctx.reply(
            '✅ *Registro reiniciado*\n\n' +
            'Se borraron tus datos locales.\n' +
            '⚠️ No se pudo limpiar el sheet (verifica que esté compartido).\n\n' +
            'Usa /start para registrarte de nuevo.',
            { parse_mode: 'Markdown' }
          );
        }
      } else {
        ctx.reply(
          '✅ *Registro reiniciado*\n\n' +
          'Tus datos han sido borrados.\n' +
          'No tenías sheet configurado.\n\n' +
          'Usa /start para registrarte de nuevo.',
          { parse_mode: 'Markdown' }
        );
      }

      pendingReinicios.delete(userId);
    } else if (respuesta === 'no' || respuesta === 'n') {
      pendingReinicios.delete(userId);
      ctx.reply('❌ Reinicio cancelado.');
    } else {
      ctx.reply('⚠️ Responde *sí* o *no*');
    }
    return;
  }

  if (pendingRegistros.has(userId)) {
    const registro = pendingRegistros.get(userId);

    if (registro.step === 'email') {
      const email = text.trim().toLowerCase();

      if (!email.includes('@')) {
        const intentos = incrementIntentosEmail(userId);
        if (intentos >= MAX_INTENTOS_EMAIL) {
          pendingRegistros.delete(userId);
          pendingIntentosEmail.delete(userId);
          return ctx.reply('❌ Demasiados intentos. Usa /start para intentar de nuevo.');
        }
        return ctx.reply(`⚠️ Email inválido. Intentos: ${intentos}/${MAX_INTENTOS_EMAIL}\nEjemplo: juan@empresa.com`);
      }

      if (!esEmailAutorizado(email)) {
        const intentos = incrementIntentosEmail(userId);
        if (intentos >= MAX_INTENTOS_EMAIL) {
          pendingRegistros.delete(userId);
          pendingIntentosEmail.delete(userId);
          return ctx.reply('❌ Email no autorizado. Usa /start para intentar de nuevo.');
        }
        return ctx.reply(`❌ Email no autorizado. Intentos: ${intentos}/${MAX_INTENTOS_EMAIL}`);
      }

      resetIntentosEmail(userId);
      pendingRegistros.set(userId, { step: 'sheetId', email: email, telegramUserId: userId });

      return ctx.reply(
        '✅ *Email verificado!*\n\n' +
        'Ahora configura tu Google Sheet.\n\n' +
        '📊 *Paso 1:* Comparte tu sheet con mi service account:\n\n' +
        `📧 *Email:* ${GOOGLE_SERVICE_ACCOUNT_EMAIL}\n\n` +
        'Dale permisos de "Editor"\n\n' +
        '📝Ingresa el ID de tu spreadsheet:\n' +
        'Está en la URL: docs.google.com/spreadsheets/d/**AQUI_EL_ID**/edit\n\n' +
        'Usa /cancelar para salir.'
      );
    }

    if (registro.step === 'codigoInvitacion') {
      const input = text.trim().toUpperCase();
      const codigoData = pendingCodigos.get(input);

      if (!codigoData) {
        return ctx.reply('❌ Código inválido. Pide uno nuevo al owner con /codigo');
      }

      const ownerId = codigoData.ownerId;
      if (!clientes[ownerId]) {
        pendingCodigos.delete(input);
        return ctx.reply('❌ El owner ya no existe. Pide un código nuevo.');
      }

      if (!clientes[ownerId].usuarios) {
        clientes[ownerId].usuarios = [];
      }

      if (clientes[ownerId].usuarios.includes(userId)) {
        pendingRegistros.delete(userId);
        return ctx.reply('⚠️ Ya estás autorizado.');
      }

      pendingRegistros.set(userId, {
        step: 'sheetId',
        ownerId: ownerId,
        codigo: input
      });
      pendingCodigos.delete(input);

      return ctx.reply(
        '✅ *Código válido!*\n\n' +
        'Ahora configura tu sheet.\n\n' +
        '📊 *Paso 1:* Comparte tu Google Sheet con mi service account:\n\n' +
        `📧 *Email:* ${GOOGLE_SERVICE_ACCOUNT_EMAIL}\n\n` +
        'Luego ingresa el ID de tu spreadsheet:\n' +
        'Ejemplo: `1abc123def456GHI789jkl012`\n\n' +
        'Usa /cancelar para salir.'
      );
    }

    if (registro.step === 'sheetId') {
      const sheetId = text.trim();

      if (sheetId.length < 20) {
        return ctx.reply('⚠️ El ID del spreadsheet parece muy corto. Intenta de nuevo:');
      }

      try {
        const docTest = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await docTest.loadInfo();

        const datosCliente = {
          sheetId: sheetId,
          email: registro.email,
          telegramUserId: registro.telegramUserId,
          usuarios: [],
          creadoEn: new Date().toISOString()
        };

        if (registro.ownerId && clientes[registro.ownerId]) {
          datosCliente.ownerId = registro.ownerId;
          clientes[registro.ownerId].usuarios.push(userId);
        }

        clientes[userId] = datosCliente;
        guardarClientes(clientes);

        pendingRegistros.delete(userId);

        if (registro.email) {
          ctx.reply(
            `✅ *¡Registro completado!*\n\n` +
            `📧 Email: ${registro.email}\n\n` +
            `Tu sheet ha sido configurado.\n` +
            `Ahora puedes usar el bot.\n\n` +
            `Usa /start para comenzar.`,
            { parse_mode: 'Markdown' }
          );
        } else {
          ctx.reply(
            `✅ *¡Registro completado!*\n\n` +
            `Te uniste a la cuenta del owner.\n\n` +
            `📝 *Próximos pasos:*\n` +
            `1. Comparte este email con tu sheet: *${GOOGLE_SERVICE_ACCOUNT_EMAIL}*\n` +
            `2. Dale permisos de "Editor"\n\n` +
            `Usa /start para comenzar.`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (error) {
        console.error('Error al verificar sheet:', error.message);
        ctx.reply(
          `❌ No pude acceder al sheet con ese ID.\n\n` +
          `Verifica que:\n` +
          `• El ID sea correcto\n` +
          `• El sheet existe\n` +
          `• Compartiste el sheet con ${GOOGLE_SERVICE_ACCOUNT_EMAIL}\n\n` +
          `Intenta de nuevo:`
        );
      }
    }
    return;
  }

  const cliente = obtenerClientePorUserId(userId);
  if (!cliente && !esAdminOriginal(userId)) {
    ctx.reply(
      `⚠️ No tienes una cuenta registrada.\n\n` +
      `Usa /start para registrarte.`
    );
    return;
  }

  if (pendingDeletes.has(ctx.from.id)) {
    const respuesta = text.toLowerCase().trim();
    if (respuesta === 'sí' || respuesta === 'si' || respuesta === 's' || respuesta === 'yes' || respuesta === 'y') {
      const { fila, index, desc } = pendingDeletes.get(ctx.from.id);
      try {
        console.log(`DEBUG: Eliminando fila ${index} - ${desc}`);
        await fila.delete();
        invalidateCache(ctx.from.id);
        ctx.reply('✅ *Movimiento eliminado*\n\n' + `📝 ${desc}`, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('Error al eliminar:', error.message, error.stack);
        ctx.reply('❌ Error al eliminar movimiento. Verifica los logs.');
      }
    } else if (respuesta === 'no' || respuesta === 'n') {
      ctx.reply('❌ Eliminación cancelada.');
    } else {
      ctx.reply('⚠️ Responde *sí* o *no* para confirmar.');
      return;
    }
    pendingDeletes.delete(ctx.from.id);
    return;
  }

  if (pendingLimpiezas.has(ctx.from.id)) {
    const respuesta = text.toLowerCase().trim();
    if (respuesta === 'sí' || respuesta === 'si' || respuesta === 's' || respuesta === 'yes' || respuesta === 'y') {
      const { filas } = pendingLimpiezas.get(ctx.from.id);
      try {
        await ctx.reply(`⏳ Eliminando ${filas.length} filas...`);
        
        let eliminadas = 0;
        let errores = 0;
        
        for (const item of filas) {
          try {
            await item.fila.delete();
            eliminadas++;
            console.log(`DEBUG: Eliminada fila #${item.index + 1}`);
          } catch (error) {
            errores++;
            console.error(`Error al eliminar fila #${item.index + 1}:`, error.message);
          }
        }
        
        pendingLimpiezas.delete(ctx.from.id);
        invalidateCache(ctx.from.id);
        
        let msg = `✅ *LIMPIEZA COMPLETADA*\n\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `✅ Eliminadas: ${eliminadas} filas\n`;
        if (errores > 0) {
          msg += `❌ Errores: ${errores}\n`;
        }
        msg += `\n💡 Usa /debug para verificar que todo esté limpio.`;
        
        await ctx.reply(msg, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('Error en limpieza:', error.message, error.stack);
        pendingLimpiezas.delete(ctx.from.id);
        await ctx.reply('❌ Error durante la limpieza. Intenta de nuevo.');
      }
    } else if (respuesta === 'no' || respuesta === 'n') {
      pendingLimpiezas.delete(ctx.from.id);
      await ctx.reply('✅ Limpieza cancelada. Ninguna fila fue eliminada.');
    } else {
      await ctx.reply('⚠️ Responde *sí* o *no* para confirmar.');
      return;
    }
    return;
  }

  if (pendingCotizaciones.has(ctx.from.id)) {
    const cotizacion = parseFloat(text);

    if (isNaN(cotizacion) || cotizacion <= 0) {
      ctx.reply('⚠️ Cotización inválida. Ingresá un número positivo (ej: 1250):');
      return;
    }

    cotizacionDolar = cotizacion;
    cotizacionFecha = new Date();

    const datos = pendingCotizaciones.get(ctx.from.id);
    pendingCotizaciones.delete(ctx.from.id);

    const { comando, descripcion, monto, tipo, moneda, metodoIndicado } = datos;

    if (metodoIndicado) {
      const sheet = await getSheetCliente(ctx.from.id);
      if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');

      const now = new Date();
      const fechaStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
      const horaStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      const montoPesos = Math.round(Math.abs(monto) * cotizacion * 100) / 100;

      const cliente = obtenerClientePorUserId(userId);
      const idOrigen = cliente ? (cliente.email || cliente.telegramUserId || userId) : userId;

      const rowData = {
        'Fecha': fechaStr,
        'Hora': horaStr,
        'Descripcion': descripcion,
        'Monto': monto,
        'Estado': 'Cobrado',
        'Tipo': tipo,
        'Moneda': moneda,
        'MetodoPago': metodoIndicado,
        'ID_Unico': generarIDUnico(),
        'MontoPesos': montoPesos,
        'ID_Origen': idOrigen
      };

      await sheet.addRow(rowData, { insert: true });

      const tipoTexto = tipo === 'Ingreso' ? 'Ingreso' : 'Gasto';
      const tipoEmoji = tipo === 'Ingreso' ? '💰' : '💸';

      ctx.reply(
        `${tipoEmoji} *¡${tipoTexto} registrado!*\n\n` +
        `📝 Descripción: ${descripcion}\n` +
        `💰 Monto: U$${Math.abs(monto).toLocaleString()} (cotización: $${cotizacion.toLocaleString()})\n` +
        `💵 En pesos: $${montoPesos.toLocaleString()}\n` +
        `💳 Método: ${metodoIndicado}\n` +
        `📅 Fecha: ${fechaStr}`,
        { parse_mode: 'Markdown' }
      );
    } else {
      pendingPayments.set(ctx.from.id, {
        descripcion,
        monto,
        tipo,
        moneda,
        cotizacionUsada: cotizacion
      });

      ctx.reply(
        `💳 *¿Cómo pagaste?*\n\n` +
        `Responde: efectivo / transferencia / tarjeta`,
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  if (pendingEdits.has(ctx.from.id)) {
    const editData = pendingEdits.get(ctx.from.id);
    console.log('DEBUG editar - step:', editData.step, 'texto:', text);

    if (editData.step === 'descripcion') {
      if (text === '-' || text === '- -') {
        editData.descripcion = editData.descripcionOriginal;
      } else {
        editData.descripcion = sanitizarInput(text);
      }
      editData.step = 'monto';
      pendingEdits.set(ctx.from.id, editData);

      ctx.reply(
        `💰 Monto actual: *${formatMonto(editData.montoOriginal, editData.moneda)}*\n\n` +
        'Escribí el nuevo monto (o enviai "- -" para mantener)',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (editData.step === 'monto') {
      const nuevoMonto = parseFloat(text);
      if (text === '-' || text === '- -' || isNaN(nuevoMonto)) {
        editData.nuevoMonto = editData.montoOriginal;
      } else {
        editData.nuevoMonto = editData.tipo === 'Egreso' && nuevoMonto > 0 ? -nuevoMonto : nuevoMonto;
      }
      editData.step = 'confirmar';
      pendingEdits.set(ctx.from.id, editData);

      const huboCambios = editData.descripcion !== editData.descripcionOriginal || editData.nuevoMonto !== editData.montoOriginal;

      if (!huboCambios) {
        ctx.reply('ℹ️ No hiciste ningún cambio. Edición cancelada.');
        pendingEdits.delete(ctx.from.id);
        return;
      }

      ctx.reply(
        `📝 *Resumen de cambios:*\n\n` +
        `Descripción: ${editData.descripcion}\n` +
        `Monto: ${formatMonto(editData.nuevoMonto, editData.moneda)}\n\n` +
        `¿Guardar cambios? Responde *sí* o *no*`
      );
      pendingEdits.set(ctx.from.id, editData);
      return;
    }

    if (editData.step === 'confirmar') {
      const respuesta = text.toLowerCase().trim();
      if (respuesta === 'sí' || respuesta === 'si' || respuesta === 's' || respuesta === 'yes' || respuesta === 'y') {
        try {
          if (editData.moneda === 'Dólares' && !cotizacionDolar) {
            await obtenerCotizacionDolar();
          }

          const fila = editData.fila;
          if (editData.descripcion !== editData.descripcionOriginal) {
            fila.set('Descripcion', editData.descripcion);
          }
          if (editData.nuevoMonto !== editData.montoOriginal) {
            fila.set('Monto', editData.nuevoMonto);
            if (editData.moneda === 'Dólares') {
              fila.set('MontoPesos', convertirAPesos(editData.nuevoMonto, editData.moneda));
            }
          }
          await fila.save();

          ctx.reply(
            `✅ *Movimiento actualizado*\n\n` +
            `📝 ${fila.get('Descripcion')}\n` +
            `💰 ${formatMonto(parseFloat(fila.get('Monto')), editData.moneda)}`
          );
        } catch (error) {
          console.error('Error al editar:', error.message);
          ctx.reply('❌ Error al guardar cambios.');
        }
      } else {
        ctx.reply('❌ Edición cancelada.');
      }
      pendingEdits.delete(ctx.from.id);
      return;
    }
  }

  if (pendingPayments.has(ctx.from.id)) {
    const metodo = text.toLowerCase().trim();
    if (METODOS_VALIDOS.includes(metodo)) {
      const pendingData = pendingPayments.get(ctx.from.id);
      try {
        const sheet = await getSheetCliente(ctx.from.id);
        if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');

        const now = new Date();
        const fechaStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
        const horaStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        let montoPesos;
        if (pendingData.moneda === 'Dólares' && pendingData.cotizacionUsada) {
          montoPesos = Math.round(Math.abs(pendingData.monto) * pendingData.cotizacionUsada * 100) / 100;
        } else {
          if (!cotizacionDolar) await obtenerCotizacionDolar();
          montoPesos = convertirAPesos(pendingData.monto, pendingData.moneda);
        }

        const cliente = obtenerClientePorUserId(userId);
        const idOrigen = cliente ? (cliente.email || cliente.telegramUserId || userId) : userId;

        const rowData = {
          'Fecha': fechaStr,
          'Hora': horaStr,
          'Descripcion': pendingData.descripcion,
          'Monto': pendingData.monto,
          'Estado': 'Cobrado',
          'Tipo': pendingData.tipo,
          'Moneda': pendingData.moneda,
          'MetodoPago': metodo,
          'ID_Unico': generarIDUnico(),
          'MontoPesos': montoPesos,
          'ID_Origen': idOrigen
        };

        await sheet.addRow(rowData, { insert: true });

        const tipoEmoji = pendingData.tipo === 'Ingreso' ? '💰' : '💸';

        let mensajeMonto = formatMonto(pendingData.monto, pendingData.moneda);
        if (pendingData.moneda === 'Dólares' && pendingData.cotizacionUsada) {
          mensajeMonto = `U$${Math.abs(pendingData.monto).toLocaleString()} (cotización: $${pendingData.cotizacionUsada.toLocaleString()})\n💵 En pesos: $${montoPesos.toLocaleString()}`;
        }

        ctx.reply(
          `${tipoEmoji} *¡${pendingData.tipo} registrado!*\n\n` +
          `📝 Descripción: ${pendingData.descripcion}\n` +
          `💰 Monto: ${mensajeMonto}\n` +
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
  let monto = parseFloat(match[3]);

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

  if (moneda === 'Dólares') {
    pendingCotizaciones.set(ctx.from.id, {
      comando,
      descripcion,
      monto,
      tipo,
      moneda,
      metodoIndicado
    });

    return ctx.reply(
      `💵 *Movimiento en dólares*\n\n` +
      `Monto: U$${Math.abs(monto).toLocaleString()}\n\n` +
      `Ingresá la cotización del dólar (ej: 1250):`
    );
  }

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

    const sheet = await getSheetCliente(ctx.from.id);
    if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');

    const now = new Date();
    const fechaStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
    const horaStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    if (!cotizacionDolar) await obtenerCotizacionDolar();
    const montoPesos = convertirAPesos(monto, moneda);

    const cliente = obtenerClientePorUserId(ctx.from.id);
    const idOrigen = cliente ? (cliente.email || cliente.telegramUserId || ctx.from.id) : ctx.from.id;

    const rowData = {
      'Fecha': fechaStr,
      'Hora': horaStr,
      'Descripcion': descripcion,
      'Monto': monto,
      'Estado': 'Cobrado',
      'Tipo': tipo,
      'Moneda': moneda,
      'MetodoPago': metodoIndicado,
      'ID_Unico': generarIDUnico(),
      'MontoPesos': montoPesos,
      'ID_Origen': idOrigen
    };

    await sheet.addRow(rowData, { insert: true });

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

bot.command('dolar', async (ctx) => {
  try {
    console.log('Comando /dolar ejecutado. Cotización actual:', cotizacionDolar);

    if (!cotizacionDolar) {
      await ctx.reply('⏳ Obteniendo cotización de Bluelytics...');
      const cotizacion = await obtenerCotizacionDolar();
      if (!cotizacion) {
        return ctx.reply('❌ No se pudo obtener la cotización desde Bluelytics.\n\nPodés usar `/actualizardolar` para reintentar o configurar manualmente en .env con COTIZACION_DEFAULT.');
      }
    }

    const fechaFormateada = cotizacionFecha ? cotizacionFecha.toLocaleString('es-AR') : 'desconocida';
    ctx.reply(
      `💵 *Cotización Dólar Blue*\n\n` +
      `📊 Promedio: $${cotizacionDolar.toLocaleString('es-AR')}\n` +
      `🕐 Actualizada: ${fechaFormateada}\n\n` +
      `Fuente: Bluelytics`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error /dolar:', error.message);
    ctx.reply('❌ Error al obtener cotización.');
  }
});

bot.command('actualizardolar', async (ctx) => {
  try {
    await ctx.reply('⏳ Actualizando cotización...');
    const cotizacion = await obtenerCotizacionDolar();
    if (cotizacion) {
      ctx.reply(`✅ Cotización actualizada a $${cotizacion.toLocaleString('es-AR')}`);
    } else {
      ctx.reply('❌ No se pudo actualizar la cotización.');
    }
  } catch (error) {
    ctx.reply('❌ Error al actualizar cotización.');
  }
});

bot.command('help', async (ctx) => {
  const helpMsg = `📚 *Manual de comandos*

*📝 Registrar movimientos:*
/agregar - Agregar ingreso o gasto

*📋 Ver movimientos:*
/listar - Últimos 10 movimientos
/estado - Resumen financiero (totales)

*✏️ Editar movimientos:*
/eliminar [nombre/ID] - Eliminar movimiento
/editar [nombre/ID] - Editar movimiento

*💱 Moneda:*
/dolar - Ver cotizaciones del dólar

*⚙️ Configuración:*
/configurar - Configurar tu Google Sheet
/regenerar_ids - Generar IDs faltantes

*💡 Tips:*
• Usa /eliminar o /editar seguido del nombre o ID
• Los IDs únicos permiten buscar con precisión
• /regenerar_ids llena IDs en movimientos antiguos

_Usa /agregar para registrar un movimiento_`;
  ctx.reply(helpMsg, { parse_mode: 'Markdown' });
});

bot.launch().then(async () => {
  console.log('Bot iniciado correctamente');
  await obtenerCotizacionDolar();
  console.log(`Cotización inicial: ${cotizacionDolar || 'No disponible'}`);
}).catch(err => {
  console.error('Error al iniciar:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
