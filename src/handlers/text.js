const { bot } = require('../lib/telegraf');
const { GoogleSpreadsheet, serviceAccountAuth } = require('../lib/google');
const { GOOGLE_SERVICE_ACCOUNT_EMAIL, MAX_INTENTOS_EMAIL, METODOS_VALIDOS, COMANDOS_INGRESO, COMANDOS_EGRESO } = require('../config');
const state = require('../state');
const { esAdminOriginal, obtenerClientePorUserId, esEmailAutorizado, incrementIntentosEmail, resetIntentosEmail } = require('../auth');
const clienteService = require('../services/cliente.service');
const { getSheetCliente, invalidateCache } = require('../services/sheet.service');
const { generarIDUnico, convertirAPesos } = require('../services/movimiento.service');
const { obtenerCotizacionDolar } = require('../services/cotizacion.service');
const { formatMonto, sanitizarInput } = require('../utils/formatter');
const geminiService = require('../services/gemini.service');
const { handleNLPIntent } = require('../handlers/nlp');

const regexMsg = /^(consulta|servicio|gasto)\s+(.+?)\s+(?:\$|U\$|USD)?\s*(-?\d+(?:\.\d{1,2})?)\s*((?:efectivo|transferencia|tarjeta))?$/i;

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;

  if (text.startsWith('/')) return;

  if (state.pendingReinicios.has(userId)) {
    const respuesta = text.toLowerCase().trim();
    if (respuesta === 'sí' || respuesta === 'si' || respuesta === 's' || respuesta === 'yes' || respuesta === 'y') {
      const cliente = obtenerClientePorUserId(userId);

      const clientes = clienteService.clientes;
      delete clientes[userId];
      clienteService.guardarClientes(clientes);

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

      state.pendingReinicios.delete(userId);
    } else if (respuesta === 'no' || respuesta === 'n') {
      state.pendingReinicios.delete(userId);
      ctx.reply('❌ Reinicio cancelado.');
    } else {
      ctx.reply('⚠️ Responde *sí* o *no*');
    }
    return;
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
        clienteService.guardarClientes(clientes);

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

  if (state.pendingDeletes.has(ctx.from.id)) {
    const respuesta = text.toLowerCase().trim();
    if (respuesta === 'sí' || respuesta === 'si' || respuesta === 's' || respuesta === 'yes' || respuesta === 'y') {
      const { fila, index, desc } = state.pendingDeletes.get(ctx.from.id);
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
    state.pendingDeletes.delete(ctx.from.id);
    return;
  }

  if (state.pendingLimpiezas.has(ctx.from.id)) {
    const respuesta = text.toLowerCase().trim();
    if (respuesta === 'sí' || respuesta === 'si' || respuesta === 's' || respuesta === 'yes' || respuesta === 'y') {
      const { filas } = state.pendingLimpiezas.get(ctx.from.id);
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
        
        state.pendingLimpiezas.delete(ctx.from.id);
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
        state.pendingLimpiezas.delete(ctx.from.id);
        await ctx.reply('❌ Error durante la limpieza. Intenta de nuevo.');
      }
    } else if (respuesta === 'no' || respuesta === 'n') {
      state.pendingLimpiezas.delete(ctx.from.id);
      await ctx.reply('✅ Limpieza cancelada. Ninguna fila fue eliminada.');
    } else {
      await ctx.reply('⚠️ Responde *sí* o *no* para confirmar.');
      return;
    }
    return;
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
        `Monto: ${formatMonto(editData.nuevoMonto, editData.moneda)}\n\n` +
        `¿Guardar cambios? Responde *sí* o *no*`
      );
      state.pendingEdits.set(ctx.from.id, editData);
      return;
    }

    if (editData.step === 'confirmar') {
      const respuesta = text.toLowerCase().trim();
      if (respuesta === 'sí' || respuesta === 'si' || respuesta === 's' || respuesta === 'yes' || respuesta === 'y') {
        try {
          if (editData.moneda === 'Dólares' && !state.cotizacionDolar) {
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
      state.pendingEdits.delete(ctx.from.id);
      return;
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
    try {
      const nlpResult = await geminiService.parseMessage(userId, text);
      if (nlpResult && nlpResult.intent && nlpResult.intent !== 'desconocido') {
        const handled = await handleNLPIntent(ctx, nlpResult);
        if (handled) return;
      }
    } catch (nlpError) {
      console.error('Error NLP fallback:', nlpError.message);
    }

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

module.exports = {};
