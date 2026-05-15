const { bot } = require('../lib/telegraf');
const { METODOS_VALIDOS, COMANDOS_INGRESO, COMANDOS_EGRESO } = require('../config');
const state = require('../state');
const { esAdminOriginal, obtenerClientePorUserId } = require('../auth');
const { formatMonto, sanitizarInput, escapeMarkdown } = require('../utils/formatter');
const geminiService = require('../services/gemini.service');
const { handleNLPIntent } = require('../handlers/nlp');
const { quickParse } = require('../services/quick_nlp.service');
const registrationService = require('../services/registration.service');
const { validarTextoUsuario, normalizarDescripcion, validarMonto, validarCotizacion } = require('../utils/validation');

function shouldHandleWithQuickParseFirst(result) {
  if (!result || !result.intent) return false;

  if (result.intent !== 'registrar_movimiento') {
    return true;
  }

  const { monto, descripcion, metodo_pago } = result.entities || {};
  return Boolean(monto || descripcion || metodo_pago);
}

function extraerMetodoDesdeDescripcion(text) {
  const raw = String(text || '').trim();
  let metodo = null;
  let descripcion = raw;

  const rules = [
    { metodo: 'efectivo', pattern: /\s+(?:en|por|con)?\s*(?:efectivo|contado|cash)$/i },
    { metodo: 'transferencia', pattern: /\s+(?:en|por|con)?\s*(?:transferencia|transfer|transf|tf|tbu|mercadopago|mercado\s*pago|mp)$/i },
    { metodo: 'tarjeta', pattern: /\s+(?:en|por|con)?\s*(?:tarjeta|debito|credito|visa|master|mc)$/i },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(descripcion)) {
      metodo = rule.metodo;
      descripcion = descripcion.replace(rule.pattern, '').trim();
      break;
    }
  }

  descripcion = descripcion.replace(/\b(?:en|por|con)$/i, '').trim();

  return {
    metodo,
    descripcion: sanitizarInput(descripcion),
  };
}

const cmd = require('../services/command.service');
const { confirmButtons } = require('./actions');

const regexMsg = /^(consulta|servicio|gasto|pendiente)\s+(.+?)\s+(?:\$|U\$|USD)?\s*(-?\d+(?:\.\d{1,2})?)\s*((?:efectivo|transferencia|tarjeta))?$/i;

bot.on('text', async (ctx) => {
  try {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;

  const textValidation = validarTextoUsuario(text);
  if (!textValidation.ok) {
    return ctx.reply('⚠️ El mensaje es inválido o demasiado largo.');
  }

  if (text.startsWith('/')) return;

  if (state.pendingReinicios.has(userId)) {
    return ctx.reply('⚠️ Tenés una confirmación pendiente. Usá los botones de arriba o /cancelar para descartar.');
  }

  if (state.pendingRegistros.has(userId)) {
    const result = await registrationService.handlePendingRegistration(userId, text);
    if (result) {
      return ctx.reply(result.message, result.parse_mode ? { parse_mode: result.parse_mode } : undefined);
    }
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
    const descripcionParseada = extraerMetodoDesdeDescripcion(text);
    const descripcion = descripcionParseada.descripcion;
    const metodoPendiente = pendingDesc.metodo_pago || descripcionParseada.metodo || null;

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
      metodo_pago: metodoPendiente,
      estado: pendingDesc.estado || 'Cobrado',
      categoria: pendingDesc.categoria || null,
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
    const cotizacionValidation = validarCotizacion(text.replace(',', '.'));

    if (!cotizacionValidation.ok) {
      ctx.reply('⚠️ Cotización inválida. Ingresá un número positivo (ej: 1250):');
      return;
    }

    const cotizacion = cotizacionValidation.valor;

    state.cotizacionDolar = cotizacion;
    state.cotizacionFecha = new Date();

    const datos = state.pendingCotizaciones.get(ctx.from.id);
    state.pendingCotizaciones.delete(ctx.from.id);

    const { descripcion, monto, tipo, moneda, metodoIndicado, categoria } = datos;

    if (metodoIndicado) {
        const resultado = await cmd.guardarMovimiento(ctx.from.id, {
          descripcion,
          monto,
          tipo,
          moneda,
          metodo_pago: metodoIndicado,
          categoria,
        }, {
          cotizacionUsada: cotizacion,
          estado: datos.estado || 'Cobrado',
        });

      ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' });
    } else {
      if ((datos.estado || 'Cobrado') === 'Pendiente') {
        const resultado = await cmd.guardarMovimiento(ctx.from.id, {
          descripcion,
          monto,
          tipo,
          moneda,
          metodo_pago: null,
          categoria,
        }, {
          cotizacionUsada: cotizacion,
          estado: 'Pendiente',
        });

        ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' });
      } else {
        state.pendingPayments.set(ctx.from.id, {
          descripcion,
          monto,
          tipo,
          moneda,
          categoria,
          cotizacionUsada: cotizacion,
          estado: datos.estado || 'Cobrado'
        });

        ctx.reply(
          `💳 *¿Cómo pagaste?*\n\n` +
          `Responde: efectivo / transferencia / tarjeta`,
          { parse_mode: 'Markdown' }
        );
      }
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
        const descripcionValidada = normalizarDescripcion(text);
        if (!descripcionValidada.ok) {
          return ctx.reply('⚠️ La descripción es inválida. Ingresá un texto más claro y corto:');
        }
        editData.descripcion = descripcionValidada.valor;
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
      const nuevoMonto = parseFloat(text.replace(',', '.'));
      if (text === '-' || text === '- -') {
        editData.nuevoMonto = editData.montoOriginal;
      } else {
        const montoValidado = validarMonto(nuevoMonto);
        if (!montoValidado.ok) {
          return ctx.reply('⚠️ El monto es inválido. Ingresá un número razonable distinto de 0:');
        }
        editData.nuevoMonto = editData.tipo === 'Egreso' && montoValidado.valor > 0 ? -montoValidado.valor : montoValidado.valor;
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
        `Descripción: ${escapeMarkdown(editData.descripcion)}\n` +
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
        const resultado = await cmd.guardarMovimiento(ctx.from.id, {
          descripcion: pendingData.descripcion,
          monto: pendingData.monto,
          tipo: pendingData.tipo,
          moneda: pendingData.moneda,
          metodo_pago: metodo,
          categoria: pendingData.categoria || null,
        }, {
          cotizacionUsada: pendingData.cotizacionUsada,
          estado: pendingData.estado || 'Cobrado',
        });

        ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' });

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
    if (shouldHandleWithQuickParseFirst(quickResult)) {
      try {
        const handled = await handleNLPIntent(ctx, quickResult);
        if (handled) return;
      } catch (e) {
        console.error('Error quick NLP:', e.message);
      }
    }

    if (geminiService.canAttemptRemoteNlp()) {
      await ctx.reply('🧠 Procesando...').catch(() => {});

      try {
        const nlpResult = await geminiService.parseMessage(userId, text);
        if (nlpResult && nlpResult.intent && nlpResult.intent !== 'desconocido') {
          const handled = await handleNLPIntent(ctx, nlpResult);
          if (handled) return;
        }
      } catch (nlpError) {
        console.error('Error NLP fallback:', nlpError.message);
      }
    }

    if (quickResult) {
      try {
        const handled = await handleNLPIntent(ctx, quickResult);
        if (handled) return;
      } catch (e) {
        console.error('Error quick NLP:', e.message);
      }
    }

    return ctx.reply(
      '⚠️ No entendí tu mensaje.\n\n' +
      'Podés escribir en lenguaje natural:\n' +
      '`entraron 15 lucas de Juan`\n' +
      '`se me fueron 8 lucas en insumos`\n' +
      '`ya me pagó Juan`\n' +
      '`cuánto tengo?`\n\n' +
      'O usa el formato: `consulta [paciente] $[monto] [metodo]`\n\n' +
      'Usa /ayuda para ver todos los comandos.',
      { parse_mode: 'Markdown' }
    );
  }

  const comando = match[1].toLowerCase();
  const descripcionValidada = normalizarDescripcion(match[2]);
  if (!descripcionValidada.ok) {
    return ctx.reply('⚠️ La descripción es inválida.');
  }
  const descripcion = descripcionValidada.valor;
  const montoValidado = validarMonto(match[3].replace(',', '.'));
  if (!montoValidado.ok) {
    return ctx.reply('❌ Error: el monto es inválido o demasiado grande.');
  }
  let monto = montoValidado.valor;

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
  } else if (comando === 'pendiente') {
    tipo = 'Ingreso';
  }

  const estado = comando === 'pendiente' ? 'Pendiente' : 'Cobrado';
  const categoria = comando === 'consulta'
    ? 'consulta'
    : comando === 'servicio'
      ? 'tratamiento'
      : comando === 'pendiente'
        ? 'cobro_pendiente'
        : tipo === 'Egreso'
          ? 'otro_egreso'
          : null;

  const metodoIndicado = match[4] ? match[4].toLowerCase() : null;

  if (moneda === 'Dólares') {
    state.pendingCotizaciones.set(ctx.from.id, {
      comando,
      descripcion,
      monto,
      tipo,
      moneda,
      categoria,
      metodoIndicado,
      estado,
    });

    return ctx.reply(await cmd.construirMensajeCotizacion(monto), { parse_mode: 'Markdown' });
  }

  if (!metodoIndicado && estado !== 'Pendiente') {
    state.pendingPayments.set(ctx.from.id, {
      descripcion,
      monto,
      tipo,
      moneda,
      categoria,
      estado
    });

    ctx.reply(
      `💳 *¿Cómo pagaste?*\n\n` +
      `Responde: efectivo / transferencia / tarjeta`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  try {
    await ctx.reply('⏳ Registrando...');

    const resultado = await cmd.guardarMovimiento(ctx.from.id, {
      descripcion,
      monto,
      tipo,
      moneda,
      metodo_pago: metodoIndicado,
      estado,
      categoria,
    });

    ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' });

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
