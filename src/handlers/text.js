const { bot } = require('../lib/telegraf');
const { GoogleSpreadsheet, serviceAccountAuth } = require('../lib/google');
const { GOOGLE_SERVICE_ACCOUNT_EMAIL, MAX_INTENTOS_EMAIL, METODOS_VALIDOS, COMANDOS_INGRESO, COMANDOS_EGRESO } = require('../config');
const state = require('../state');
const { esAdminOriginal, obtenerClientePorUserId, esEmailAutorizado, incrementIntentosEmail, resetIntentosEmail, codigoInvitacionExpirado } = require('../auth');
const clienteService = require('../services/cliente.service');
const { getSheetCliente } = require('../services/sheet.service');
const { generarIDUnico, convertirAPesos } = require('../services/movimiento.service');
const { obtenerCotizacionDolar } = require('../services/cotizacion.service');
const { formatMonto, sanitizarInput } = require('../utils/formatter');
const geminiService = require('../services/gemini.service');
const { handleNLPIntent } = require('../handlers/nlp');
const { quickParse } = require('../services/quick_nlp.service');
const cmd = require('../services/command.service');
const { confirmButtons } = require('./actions');

const regexMsg = /^(consulta|servicio|gasto)\s+(.+?)\s+(?:\$|U\$|USD)?\s*(-?\d+(?:\.\d{1,2})?)\s*((?:efectivo|transferencia|tarjeta))?$/i;

bot.on('text', async (ctx) => {
  try {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;

  if (text.startsWith('/')) return;

  if (state.pendingReinicios.has(userId)) {
    return ctx.reply('⚠️ Tenés una confirmación pendiente. Usá los botones de arriba o /cancelar para descartar.');
  }

  if (state.pendingRegistros.has(userId)) {
    const registro = state.pendingRegistros.get(userId);

    if (registro.step === 'email') {
      const email = text.trim().toLowerCase();

      if (!email.includes('@')) {
        const intentos = incrementIntentosEmail(userId);
        if (intentos >= MAX_INTENTOS_EMAIL) {
          state.pendingRegistros.delete(userId);
          state.pendingIntentosEmail.delete(userId);
          return ctx.reply('❌ Demasiados intentos. Usa /start para intentar de nuevo.');
        }
        return ctx.reply(`⚠️ Email inválido. Intentos: ${intentos}/${MAX_INTENTOS_EMAIL}\nEjemplo: juan@empresa.com`);
      }

      if (!esEmailAutorizado(email)) {
        const intentos = incrementIntentosEmail(userId);
        if (intentos >= MAX_INTENTOS_EMAIL) {
          state.pendingRegistros.delete(userId);
          state.pendingIntentosEmail.delete(userId);
          return ctx.reply('❌ Email no autorizado. Usa /start para intentar de nuevo.');
        }
        return ctx.reply(`❌ Email no autorizado. Intentos: ${intentos}/${MAX_INTENTOS_EMAIL}`);
      }

      resetIntentosEmail(userId);
      state.pendingRegistros.set(userId, { step: 'sheetId', email: email, telegramUserId: userId });

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
      const codigoData = state.pendingCodigos.get(input);

      if (!codigoData) {
        return ctx.reply('❌ Código inválido. Pide uno nuevo al owner con /codigo');
      }

      if (codigoInvitacionExpirado(codigoData)) {
        state.pendingCodigos.delete(input);
        return ctx.reply('❌ Código expirado. Pide uno nuevo al owner con /codigo');
      }

      const ownerId = codigoData.ownerId;
      const clientes = clienteService.clientes;
      if (!clientes[ownerId]) {
        state.pendingCodigos.delete(input);
        return ctx.reply('❌ El owner ya no existe. Pide un código nuevo.');
      }

      if (!clientes[ownerId].usuarios) {
        clientes[ownerId].usuarios = [];
      }

      if (clientes[ownerId].usuarios.includes(userId)) {
        state.pendingRegistros.delete(userId);
        return ctx.reply('⚠️ Ya estás autorizado.');
      }

      state.pendingRegistros.set(userId, {
        step: 'sheetId',
        ownerId: ownerId,
        codigo: input
      });
      state.pendingCodigos.delete(input);

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

        const clientes = clienteService.clientes;

        if (registro.ownerId && clientes[registro.ownerId]) {
          datosCliente.ownerId = registro.ownerId;
          clientes[registro.ownerId].usuarios.push(userId);
        }

        clientes[userId] = datosCliente;
        await clienteService.guardarClientes(clientes);

        state.pendingRegistros.delete(userId);

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

  if (state.pendingDescripcion.has(ctx.from.id)) {
    const pendingDesc = state.pendingDescripcion.get(ctx.from.id);
    const descripcion = sanitizarInput(text);

    if (descripcion.length < 2) {
      return ctx.reply('⚠️ La descripción es muy corta. Ingresá un nombre o concepto:');
    }

    state.pendingDescripcion.delete(ctx.from.id);

    try {
    const resultado = await cmd.registrarMovimientoDesdeNLP(ctx.from.id, {
      tipo: pendingDesc.tipo,
      descripcion: descripcion,
      monto: pendingDesc.monto,
      moneda: pendingDesc.moneda,
      metodo_pago: pendingDesc.metodo_pago
    });

    if (resultado.necesitaInfo) {
      return ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' }).catch(() => {});
    }
    if (resultado.error) {
      return ctx.reply(resultado.error);
    }
    if (resultado.success) {
      return ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' }).catch(() => {});
    }
    return ctx.reply('❌ Error al registrar movimiento.');
    } catch (error) {
      console.error('Error en pendingDescripcion:', error.message);
      ctx.reply('❌ Error al registrar movimiento. Intentá de nuevo o usa /ayuda.').catch(() => {});
    }
  }

  if (state.pendingDeletes.has(ctx.from.id)) {
    return ctx.reply('⚠️ Tenés una confirmación pendiente. Usá los botones de arriba o /cancelar para descartar.');
  }

  if (state.pendingLimpiezas.has(ctx.from.id)) {
    return ctx.reply('⚠️ Tenés una confirmación pendiente. Usá los botones de arriba o /cancelar para descartar.');
  }

  if (state.pendingAgendaConfirm.has(ctx.from.id)) {
    return ctx.reply('⚠️ Tenés una confirmación pendiente. Usá los botones de arriba o /cancelar para descartar.');
  }

  if (state.pendingCotizaciones.has(ctx.from.id)) {
    const cotizacion = parseFloat(text);

    if (isNaN(cotizacion) || cotizacion <= 0) {
      ctx.reply('⚠️ Cotización inválida. Ingresá un número positivo (ej: 1250):');
      return;
    }

    state.cotizacionDolar = cotizacion;
    state.cotizacionFecha = new Date();

    const datos = state.pendingCotizaciones.get(ctx.from.id);
    state.pendingCotizaciones.delete(ctx.from.id);

    const { comando, descripcion, monto, tipo, moneda, metodoIndicado } = datos;

    if (metodoIndicado) {
      const sheet = await getSheetCliente(ctx.from.id);
      if (!sheet) return ctx.reply('❌ Error: No tienes un sheet configurado.');

      const now = new Date();
      const fechaStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
      const horaStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      const montoPesos = Math.round(Math.abs(monto) * cotizacion * 100) / 100;

      const clienteData = obtenerClientePorUserId(userId);
      const idOrigen = clienteData ? (clienteData.email || clienteData.telegramUserId || userId) : userId;

      const idUnico = generarIDUnico();

      const rowData = {
        'Fecha': fechaStr,
        'Hora': horaStr,
        'Descripcion': descripcion,
        'Monto': monto,
        'Estado': 'Cobrado',
        'Tipo': tipo,
        'Moneda': moneda,
        'MetodoPago': metodoIndicado,
        'ID_Unico': idUnico,
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
        `📅 Fecha: ${fechaStr}\n` +
        `🆔 ID: \`${idUnico}\``,
        { parse_mode: 'Markdown' }
      );
    } else {
      state.pendingPayments.set(ctx.from.id, {
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

  if (state.pendingEdits.has(ctx.from.id)) {
    const editData = state.pendingEdits.get(ctx.from.id);
    console.log('DEBUG editar - step:', editData.step, 'texto:', text);

    if (editData.step === 'descripcion') {
      if (text === '-' || text === '- -') {
        editData.descripcion = editData.descripcionOriginal;
      } else {
        editData.descripcion = sanitizarInput(text);
      }
      editData.step = 'monto';
      state.pendingEdits.set(ctx.from.id, editData);

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
      state.pendingEdits.set(ctx.from.id, editData);

      const huboCambios = editData.descripcion !== editData.descripcionOriginal || editData.nuevoMonto !== editData.montoOriginal;

      if (!huboCambios) {
        ctx.reply('ℹ️ No hiciste ningún cambio. Edición cancelada.');
        state.pendingEdits.delete(ctx.from.id);
        return;
      }

      ctx.reply(
        `📝 *Resumen de cambios:*\n\n` +
        `Descripción: ${editData.descripcion}\n` +
        `Monto: ${formatMonto(editData.nuevoMonto, editData.moneda)}`,
        {
          parse_mode: 'Markdown',
          ...confirmButtons('confirm_edit', 'cancel_edit')
        }
      );
      state.pendingEdits.set(ctx.from.id, editData);
      return;
    }

    if (editData.step === 'confirmar') {
      return ctx.reply('⚠️ Tenés una confirmación pendiente. Usá los botones de arriba o /cancelar para descartar.');
    }
  }

  if (state.pendingPayments.has(ctx.from.id)) {
    const metodo = text.toLowerCase().trim();
    if (METODOS_VALIDOS.includes(metodo)) {
      const pendingData = state.pendingPayments.get(ctx.from.id);
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
          if (!state.cotizacionDolar) await obtenerCotizacionDolar();
          montoPesos = convertirAPesos(pendingData.monto, pendingData.moneda);
        }

        const clienteData = obtenerClientePorUserId(userId);
        const idOrigen = clienteData ? (clienteData.email || clienteData.telegramUserId || userId) : userId;

        const idUnico = generarIDUnico();

        const rowData = {
          'Fecha': fechaStr,
          'Hora': horaStr,
          'Descripcion': pendingData.descripcion,
          'Monto': pendingData.monto,
          'Estado': 'Cobrado',
          'Tipo': pendingData.tipo,
          'Moneda': pendingData.moneda,
          'MetodoPago': metodo,
          'ID_Unico': idUnico,
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
          `📅 Fecha: ${fechaStr}\n` +
          `🆔 ID: \`${idUnico}\``,
          { parse_mode: 'Markdown' }
        );

        state.pendingPayments.delete(ctx.from.id);
      } catch (error) {
        console.error('Error al guardar:', error.message);
        ctx.reply('❌ Error al guardar en Google Sheets.');
        state.pendingPayments.delete(ctx.from.id);
      }
      return;
    } else {
      ctx.reply('⚠️ Método no válido. Responde: efectivo / transferencia / tarjeta');
      return;
    }
  }

  const match = text.match(regexMsg);
  if (!match) {
    const quickResult = quickParse(text);
    if (quickResult) {
      try {
        const handled = await handleNLPIntent(ctx, quickResult);
        if (handled) return;
      } catch (e) {
        console.error('Error quick NLP:', e.message);
      }
    }

    if (!quickResult) {
      await ctx.reply('🧠 Procesando...').catch(() => {});
    }

    try {
      const nlpResult = await geminiService.parseMessage(userId, text);
      if (nlpResult && nlpResult.intent && nlpResult.intent !== 'desconocido') {
        const handled = await handleNLPIntent(ctx, nlpResult);
        if (handled) return;
      }
    } catch (nlpError) {
      console.error('Error NLP fallback:', nlpError.message);
    }

    if (!quickResult) {
      return ctx.reply(
        '⚠️ No entendí tu mensaje.\n\n' +
        'Podés escribir en lenguaje natural:\n' +
        '`cobré 15000 de Juan Perez en efectivo`\n' +
        '`gasté 5000 en alquiler`\n' +
        '`cuánto tengo?`\n\n' +
        'O usa el formato: `consulta [paciente] $[monto] [metodo]`\n\n' +
        'Usa /ayuda para ver todos los comandos.',
        { parse_mode: 'Markdown' }
      );
    }
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
    state.pendingCotizaciones.set(ctx.from.id, {
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
    state.pendingPayments.set(ctx.from.id, {
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

    if (!state.cotizacionDolar) await obtenerCotizacionDolar();
    const montoPesos = convertirAPesos(monto, moneda);

    const clienteData = obtenerClientePorUserId(ctx.from.id);
    const idOrigen = clienteData ? (clienteData.email || clienteData.telegramUserId || ctx.from.id) : ctx.from.id;

    const idUnico = generarIDUnico();

    const rowData = {
      'Fecha': fechaStr,
      'Hora': horaStr,
      'Descripcion': descripcion,
      'Monto': monto,
      'Estado': 'Cobrado',
      'Tipo': tipo,
      'Moneda': moneda,
      'MetodoPago': metodoIndicado,
      'ID_Unico': idUnico,
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
      `📅 Fecha: ${fechaStr}\n` +
      `🆔 ID: \`${idUnico}\``,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Error al guardar:', error.message);
    ctx.reply('❌ Error al guardar en Google Sheets.');
  }
  } catch (error) {
    console.error('Error en text handler:', error);
    ctx.reply('❌ Ocurrió un error inesperado. Intentá de nuevo.').catch(() => {});
  }
});

module.exports = {};
