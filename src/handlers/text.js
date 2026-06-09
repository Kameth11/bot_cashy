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
const { actualizarCampoNlp, crearMensajeConfirmacion, discardButtons } = require('./nlp-confirm');

const CATEGORIAS_INGRESO_PACIENTE = {
  consulta: 'consulta',
  tratamiento: 'tratamiento',
  servicio: 'tratamiento',
  anticipo: 'anticipo',
  adelanto: 'anticipo',
  sena: 'sena',
  seña: 'sena',
  cuota: 'cuota',
  saldo: 'saldo_final',
  saldo_final: 'saldo_final',
};

function normalizarCategoriaIngresoPaciente(text) {
  const normalized = sanitizarInput(text || '', 40)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');

  return CATEGORIAS_INGRESO_PACIENTE[normalized] || null;
}

function normalizarMonedaTexto(text) {
  const normalized = sanitizarInput(text || '', 20)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (['$', 'peso', 'pesos', 'ars'].includes(normalized)) return 'Pesos';
  if (['u$', 'usd', 'dolar', 'dolares', 'dolar_es', 'dolar estadounidense'].includes(normalized)) return 'Dólares';
  if (['eur', 'euro', 'euros', '€'].includes(normalized)) return 'Euros';
  return null;
}

function normalizarSiNo(text) {
  const normalized = sanitizarInput(text || '', 10)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (['si', 's', 'yes', 'y'].includes(normalized)) return true;
  if (['no', 'n'].includes(normalized)) return false;
  return null;
}

function etiquetaCategoria(categoria) {
  const map = {
    consulta: 'consulta',
    tratamiento: 'tratamiento',
    anticipo: 'anticipo',
    sena: 'seña',
    cuota: 'cuota',
    saldo_final: 'saldo final',
  };
  return map[categoria] || categoria;
}

const TRATAMIENTO_KEYWORDS = [
  'implante',
  'ortodoncia',
  'endodoncia',
  'limpieza',
  'blanqueamiento',
  'extraccion',
  'extracción',
  'carilla',
  'corona',
  'protesis',
  'prótesis',
  'brackets',
  'perno',
  'conducto',
];

function extraerProfesionalDesdeTexto(text) {
  const match = String(text || '').match(/\b(?:con\s+)?((?:dra?\.?|doctora|doctor)\s+[a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})\b/i);
  if (!match || !match[1]) return null;
  return sanitizarInput(match[1])
    .replace(/\bdoctora\b/i, 'Dra')
    .replace(/\bdoctor\b/i, 'Dr')
    .replace(/\bdra?\.?/i, m => m.toLowerCase().startsWith('dra') ? 'Dra' : 'Dr');
}

function extraerTratamientoDesdeTexto(text) {
  for (const keyword of TRATAMIENTO_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    const match = String(text || '').match(regex);
    if (match) return sanitizarInput(match[0]);
  }
  return null;
}

function limpiarDescripcionBase(text, profesional, tratamiento) {
  let cleaned = sanitizarInput(text || '');
  if (profesional) {
    cleaned = cleaned.replace(new RegExp(`\\bcon\\s+${profesional}\\b`, 'i'), '').replace(new RegExp(`\\b${profesional}\\b`, 'i'), '').trim();
  }
  if (tratamiento) {
    cleaned = cleaned.replace(new RegExp(`\\b${tratamiento}\\b`, 'i'), '').trim();
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

function extraerPacienteDesdeDescripcion(comando, descripcion, profesional, tratamiento) {
  const cleaned = limpiarDescripcionBase(descripcion, profesional, tratamiento)
    .replace(/\b(?:de|del|para|por|paciente)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;
  if (comando === 'consulta' || comando === 'pendiente') return cleaned;

  const byConnector = String(descripcion || '').match(/\bde\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3})\b/i);
  if (byConnector && byConnector[1]) return sanitizarInput(byConnector[1]);
  return null;
}

function inferirCamposDesdeComando(comando, descripcion, categoria) {
  const profesionalNombre = extraerProfesionalDesdeTexto(descripcion);
  const tratamientoNombre = extraerTratamientoDesdeTexto(descripcion) || (categoria === 'consulta' ? 'Consulta' : null);
  const pacienteNombre = extraerPacienteDesdeDescripcion(comando, descripcion, profesionalNombre, tratamientoNombre);

  return {
    categoria,
    pacienteNombre,
    profesionalNombre,
    tratamientoNombre,
  };
}

function inferirCategoriaDesdeComando(comando, tipo, descripcion) {
  const desc = String(descripcion || '').trim().toLowerCase();

  if (comando === 'consulta') return 'consulta';
  if (comando === 'servicio') {
    if (/anticipo|adelanto/.test(desc)) return 'anticipo';
    if (/sena|seña|reserva/.test(desc)) return 'sena';
    if (/cuota/.test(desc)) return 'cuota';
    if (/saldo/.test(desc)) return 'saldo_final';
    return 'tratamiento';
  }
  if (comando === 'pendiente') return 'cobro_pendiente';
  if (tipo === 'Egreso') {
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

  return null;
}

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

const regexMsg = /^(consulta|servicio|gasto|pendiente)\s+(.+?)\s+(?:\$|U\$|USD|€|EUR)?\s*(-?\d+(?:\.\d{1,2})?)\s*((?:efectivo|transferencia|tarjeta))?$/i;

bot.on('text', async (ctx) => {
  try {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;

  const textValidation = validarTextoUsuario(text);
  if (!textValidation.ok) {
    return ctx.reply('⚠️ El mensaje es inválido o demasiado largo.');
  }

  if (text.startsWith('/')) return;

  // Confirmación de /salir
  const { procesarConfirmacionSalir } = require('./commands/salir');
  if (state.pendingReinicios.has(`salir_${userId}`)) {
    return procesarConfirmacionSalir(ctx);
  }

  if (state.pendingReinicios.has(userId)) {
    return ctx.reply('⚠️ Tenés una confirmación pendiente. Usá los botones de arriba o /cancelar para descartar.');
  }

  // NLP confirmation flow
  if (state.pendingNlpMovimientos.has(userId)) {
    const pending = state.pendingNlpMovimientos.get(userId);
    if (pending.editingCampo) {
      return actualizarCampoNlp(ctx, userId, pending, text);
    }
    // New text while a movement is pending confirmation → ask to discard
    return ctx.reply(
      `⚠️ Tenés un movimiento pendiente de confirmación:\n\n${crearMensajeConfirmacion(pending.entities)}\n\n` +
      `¿Qué hacemos con tu nuevo mensaje?`,
      { parse_mode: 'Markdown', ...discardButtons() }
    );
  }

  if (state.pendingRegistros.has(userId)) {
    const result = await registrationService.handlePendingRegistration(userId, text);
    if (result) {
      return ctx.reply(result.message, result.parse_mode ? { parse_mode: result.parse_mode } : undefined);
    }
    return;
  }

  if (state.pendingIngresoPacientes.has(userId)) {
    const pendingIngreso = state.pendingIngresoPacientes.get(userId);
    const payload = pendingIngreso.data;

    if (pendingIngreso.step === 'paciente') {
      const pacienteValidado = normalizarDescripcion(text);
      if (!pacienteValidado.ok) {
        return ctx.reply('⚠️ El nombre del paciente es inválido. Escribí un nombre más claro:');
      }

      payload.pacienteNombre = pacienteValidado.valor;
      pendingIngreso.step = 'profesional';
      state.pendingIngresoPacientes.set(userId, pendingIngreso);

      return ctx.reply('2. Escribí el profesional responsable:');
    }

    if (pendingIngreso.step === 'profesional') {
      const profesionalValidado = normalizarDescripcion(text);
      if (!profesionalValidado.ok) {
        return ctx.reply('⚠️ El profesional es inválido. Escribí un nombre más claro:');
      }

      payload.profesionalNombre = profesionalValidado.valor;
      pendingIngreso.step = 'categoria';
      state.pendingIngresoPacientes.set(userId, pendingIngreso);

      return ctx.reply(
        '3. Indicá la categoría:\n\n' +
        'consulta / tratamiento / anticipo / seña / cuota / saldo final'
      );
    }

    if (pendingIngreso.step === 'categoria') {
      const categoria = normalizarCategoriaIngresoPaciente(text);
      if (!categoria) {
        return ctx.reply('⚠️ Categoría inválida. Usá: consulta / tratamiento / anticipo / seña / cuota / saldo final');
      }

      payload.categoria = categoria;
      pendingIngreso.step = 'detalle';
      state.pendingIngresoPacientes.set(userId, pendingIngreso);

      return ctx.reply('4. Escribí el tratamiento o detalle adicional. Si no querés agregarlo, respondé `-`.', {
        parse_mode: 'Markdown'
      });
    }

    if (pendingIngreso.step === 'detalle') {
      if (text !== '-' && text !== '- -') {
        const detalleValidado = normalizarDescripcion(text);
        if (!detalleValidado.ok) {
          return ctx.reply('⚠️ El detalle es inválido. Escribí algo más claro o `-` para omitirlo.');
        }
        payload.tratamientoNombre = detalleValidado.valor;
      }

      pendingIngreso.step = 'monto';
      state.pendingIngresoPacientes.set(userId, pendingIngreso);
      return ctx.reply('5. Escribí el monto:');
    }

    if (pendingIngreso.step === 'monto') {
      const montoValidado = validarMonto(text.replace(',', '.'));
      if (!montoValidado.ok) {
        return ctx.reply('⚠️ El monto es inválido. Ingresá un número razonable distinto de 0:');
      }

      payload.monto = montoValidado.valor;
      pendingIngreso.step = 'moneda';
      state.pendingIngresoPacientes.set(userId, pendingIngreso);
      return ctx.reply('6. Indicá la moneda: pesos, dólares o euros');
    }

    if (pendingIngreso.step === 'moneda') {
      const moneda = normalizarMonedaTexto(text);
      if (!moneda) {
        return ctx.reply('⚠️ Moneda inválida. Respondé: pesos, dólares o euros');
      }

      payload.moneda = moneda;
      pendingIngreso.step = 'cobrado';
      state.pendingIngresoPacientes.set(userId, pendingIngreso);
      return ctx.reply('7. ¿Ya se cobró? Respondé si o no');

    }

    if (pendingIngreso.step === 'cobrado') {
      const cobrado = normalizarSiNo(text);
      if (cobrado === null) {
        return ctx.reply('⚠️ Respuesta inválida. Respondé: si o no');
      }

      payload.estado = cobrado ? 'Cobrado' : 'Pendiente';

      if (!cobrado) {
        state.pendingIngresoPacientes.delete(userId);
        const descripcionFinal = payload.tratamientoNombre
          ? `${etiquetaCategoria(payload.categoria)} ${payload.pacienteNombre} - ${payload.tratamientoNombre}`
          : `${etiquetaCategoria(payload.categoria)} ${payload.pacienteNombre}`;

        const resultado = await cmd.guardarMovimiento(userId, {
          descripcion: descripcionFinal,
          monto: payload.monto,
          tipo: payload.tipo,
          moneda: payload.moneda,
          metodo_pago: null,
          estado: 'Pendiente',
          categoria: payload.categoria,
          pacienteNombre: payload.pacienteNombre,
          profesionalNombre: payload.profesionalNombre,
          tratamientoNombre: payload.tratamientoNombre,
        }, {
          estado: 'Pendiente',
        });

        return ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' });
      }

      pendingIngreso.step = 'metodo';
      state.pendingIngresoPacientes.set(userId, pendingIngreso);
      return ctx.reply('8. Indicá el método de pago: efectivo / transferencia / tarjeta');
    }

    if (pendingIngreso.step === 'metodo') {
      const metodo = text.toLowerCase().trim();
      if (!METODOS_VALIDOS.includes(metodo)) {
        return ctx.reply('⚠️ Método inválido. Respondé: efectivo / transferencia / tarjeta');
      }

      payload.metodo_pago = metodo;
      state.pendingIngresoPacientes.delete(userId);

      const descripcionFinal = payload.tratamientoNombre
        ? `${etiquetaCategoria(payload.categoria)} ${payload.pacienteNombre} - ${payload.tratamientoNombre}`
        : `${etiquetaCategoria(payload.categoria)} ${payload.pacienteNombre}`;

      const resultado = await cmd.guardarMovimiento(userId, {
        descripcion: descripcionFinal,
        monto: payload.monto,
        tipo: payload.tipo,
        moneda: payload.moneda,
        metodo_pago: payload.metodo_pago,
        estado: 'Cobrado',
        categoria: payload.categoria,
        pacienteNombre: payload.pacienteNombre,
        profesionalNombre: payload.profesionalNombre,
        tratamientoNombre: payload.tratamientoNombre,
      });

      return ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' });
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
      subcategoria: pendingDesc.subcategoria || null,
      pacienteNombre: pendingDesc.pacienteNombre || null,
      pagadorNombre: pendingDesc.pagadorNombre || null,
      profesionalNombre: pendingDesc.profesionalNombre || null,
      proveedorNombre: pendingDesc.proveedorNombre || null,
      tratamientoNombre: pendingDesc.tratamientoNombre || null,
      fechaPrestacion: pendingDesc.fechaPrestacion || null,
      fechaCobroReal: pendingDesc.fechaCobroReal || null,
      fechaVencimiento: pendingDesc.fechaVencimiento || null,
      referenciaId: pendingDesc.referenciaId || null,
      notas: pendingDesc.notas || null,
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
      return;
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

    const {
      descripcion,
      monto,
      tipo,
      moneda,
      metodoIndicado,
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

    if (metodoIndicado) {
        const resultado = await cmd.guardarMovimiento(ctx.from.id, {
          descripcion,
          monto,
          tipo,
          moneda,
          metodo_pago: metodoIndicado,
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
          subcategoria,
          pacienteNombre,
          profesionalNombre,
          proveedorNombre,
          tratamientoNombre,
          fechaPrestacion,
          fechaCobroReal,
          fechaVencimiento,
          referenciaId,
          notas,
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
          subcategoria: pendingData.subcategoria || null,
          pacienteNombre: pendingData.pacienteNombre || null,
          pagadorNombre: pendingData.pagadorNombre || null,
          profesionalNombre: pendingData.profesionalNombre || null,
          proveedorNombre: pendingData.proveedorNombre || null,
          tratamientoNombre: pendingData.tratamientoNombre || null,
          fechaPrestacion: pendingData.fechaPrestacion || null,
          fechaCobroReal: pendingData.fechaCobroReal || null,
          fechaVencimiento: pendingData.fechaVencimiento || null,
          referenciaId: pendingData.referenciaId || null,
          notas: pendingData.notas || null,
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
    if (state.processingNlp.has(userId)) {
      return ctx.reply('⏳ Espera, todavía estoy procesando tu mensaje anterior...');
    }
    state.processingNlp.add(userId);
    try {
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
          const movResult = await geminiService.parseMovimientoEntidades(userId, text);
          if (movResult && movResult.entities && movResult.entities.monto) {
            const handled = await handleNLPIntent(ctx, movResult);
            if (handled) return;
          }

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
        'No entendí bien ese mensaje 🤔\n\n' +
        'Podés intentar con un formato más claro, por ejemplo:\n' +
        '  • consulta Juan $15000 efectivo\n' +
        '  • gasto insumos $500 transferencia\n' +
        '  • me deben €200 de García\n\n' +
        'O usá /registrar para cargarlo paso a paso.'
      );
    } finally {
      state.processingNlp.delete(userId);
    }
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
  } else if (textOriginal.includes('€') || textOriginal.includes('eur')) {
    moneda = 'Euros';
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
  const categoria = inferirCategoriaDesdeComando(comando, tipo, descripcion);
  const camposEstructurados = inferirCamposDesdeComando(comando, descripcion, categoria);

  const metodoIndicado = match[4] ? match[4].toLowerCase() : null;

  if (moneda === 'Dólares') {
    state.pendingCotizaciones.set(ctx.from.id, {
      comando,
      descripcion,
      monto,
      tipo,
      moneda,
      categoria,
      pacienteNombre: camposEstructurados.pacienteNombre,
      profesionalNombre: camposEstructurados.profesionalNombre,
      tratamientoNombre: camposEstructurados.tratamientoNombre,
      metodoIndicado,
      estado,
    });

    return ctx.reply(await cmd.construirMensajeCotizacion(monto), { parse_mode: 'Markdown' });
  }

  if (moneda === 'Euros') {
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
        pacienteNombre: camposEstructurados.pacienteNombre,
        profesionalNombre: camposEstructurados.profesionalNombre,
        tratamientoNombre: camposEstructurados.tratamientoNombre,
      });
      return ctx.reply(resultado.mensaje, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error al guardar en euros:', error.message);
      return ctx.reply('❌ Error al guardar en Google Sheets.');
    }
  }

  if (!metodoIndicado && estado !== 'Pendiente') {
    state.pendingPayments.set(ctx.from.id, {
      descripcion,
      monto,
      tipo,
      moneda,
      categoria,
      pacienteNombre: camposEstructurados.pacienteNombre,
      profesionalNombre: camposEstructurados.profesionalNombre,
      tratamientoNombre: camposEstructurados.tratamientoNombre,
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
      pacienteNombre: camposEstructurados.pacienteNombre,
      profesionalNombre: camposEstructurados.profesionalNombre,
      tratamientoNombre: camposEstructurados.tratamientoNombre,
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
