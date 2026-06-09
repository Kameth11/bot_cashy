const geminiService = require('../services/gemini.service');
const cmd = require('../services/command.service');
const state = require('../state');
const { handleSheetCommand } = require('./commands/sheet');
const { confirmButtons } = require('./actions');
const { mostrarConfirmacion } = require('./nlp-confirm');
const { DASHBOARD_URL } = require('../config');

function replyWithDashboard(ctx, msg) {
  const extra = { parse_mode: 'Markdown' };
  if (DASHBOARD_URL) extra.reply_markup = { inline_keyboard: [[{ text: '📊 Ver Dashboard', url: DASHBOARD_URL }]] };
  return ctx.reply(msg, extra);
}

const INTENT_HANDLERS = {
  ver_balance: async (ctx, entities) => {
    const msg = await cmd.ejecutarBalance(ctx.from.id);
    return replyWithDashboard(ctx, msg);
  },

  ver_hoy: async (ctx, entities) => {
    const msg = await cmd.ejecutarHoy(ctx.from.id);
    return replyWithDashboard(ctx, msg);
  },

  ver_semana: async (ctx, entities) => {
    const msg = await cmd.ejecutarSemana(ctx.from.id);
    return replyWithDashboard(ctx, msg);
  },

  ver_mes: async (ctx, entities) => {
    const msg = await cmd.ejecutarMes(ctx.from.id);
    return replyWithDashboard(ctx, msg);
  },

  ver_ingresos: async (ctx, entities) => {
    const msg = await cmd.ejecutarIngresos(ctx.from.id);
    return replyWithDashboard(ctx, msg);
  },

  ver_egresos: async (ctx, entities) => {
    const msg = await cmd.ejecutarEgresos(ctx.from.id);
    return replyWithDashboard(ctx, msg);
  },

  ver_pendientes: async (ctx, entities) => {
    const msg = await cmd.ejecutarPendientes(ctx.from.id);
    return replyWithDashboard(ctx, msg);
  },

  ver_dolar: async (ctx, entities) => {
    const msg = await cmd.ejecutarDolar();
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  },

  actualizardolar: async (ctx, entities) => {
    const msg = await cmd.ejecutarActualizarDolar();
    return ctx.reply(msg);
  },

  ver_sheet: async (ctx, entities) => {
    return handleSheetCommand(ctx);
  },

  ver_ayuda: async (ctx, entities) => {
    return ctx.reply(
      '📖 *Comandos disponibles:*\n\n' +
      '📝 *Registrar movimiento:*\n' +
      '`consulta Juan Perez $15000 efectivo` (ingreso pesos)\n' +
      '`servicio Endodoncia U$50 transferencia` (ingreso dólares)\n' +
      '`gasto Insumos $-500` (egreso)\n' +
      '`pendiente Juan Perez $15000` (ingreso sin cobrar)\n' +
      '`/ingreso_paciente` (carga guiada con paciente, profesional y categoría)\n\n' +
      '💬 *También podés escribir en lenguaje natural:*\n' +
      '`cobré 15000 de Juan Perez en efectivo`\n' +
      '`gasté 5000 en alquiler`\n' +
      '`cuánto tengo?`\n' +
      '`pendientes`\n\n' +
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
      '`/sheet` - Ver link de tu Google Sheet',
      { parse_mode: 'Markdown' }
    );
  },

  listar_movimientos: async (ctx, entities) => {
    const msg = await cmd.ejecutarListar(ctx.from.id);
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  },

  cobrar_movimiento: async (ctx, entities) => {
    const nombre = entities.nombre || null;
    const msg = await cmd.ejecutarCobrar(ctx.from.id, nombre);
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  },

  editar_movimiento: async (ctx, entities) => {
    const nombre = entities.nombre || null;
    const result = await cmd.prepararEdicion(ctx.from.id, nombre);
    if (typeof result === 'string') {
      return ctx.reply(result, { parse_mode: 'Markdown' });
    }
    if (result && result.state) {
      state.pendingEdits.set(ctx.from.id, result.state);
      return ctx.reply(result.mensaje, { parse_mode: 'Markdown' });
    }
    return ctx.reply('❌ Error al buscar movimiento.');
  },

  eliminar_movimiento: async (ctx, entities) => {
    const nombre = entities.nombre || null;
    const result = await cmd.prepararEliminacion(ctx.from.id, nombre);
    if (typeof result === 'string') {
      return ctx.reply(result, { parse_mode: 'Markdown' });
    }
    if (result && result.state) {
      state.pendingDeletes.set(ctx.from.id, result.state);
      return ctx.reply(result.mensaje, {
        parse_mode: 'Markdown',
        ...confirmButtons('confirm_delete', 'cancel_delete')
      });
    }
    return ctx.reply('❌ Error al buscar movimiento.');
  },

  registrar_movimiento: async (ctx, entities) => {
    await mostrarConfirmacion(ctx, {
      tipo: entities.tipo || 'ingreso',
      descripcion: entities.descripcion || null,
      monto: entities.monto || null,
      moneda: entities.moneda || 'Pesos',
      metodo_pago: entities.metodo_pago || null,
      estado: entities.estado || 'Cobrado',
      categoria: entities.categoria || null,
      subcategoria: entities.subcategoria || null,
      pacienteNombre: entities.pacienteNombre || null,
      pagadorNombre: entities.pagadorNombre || null,
      profesionalNombre: entities.profesionalNombre || null,
      proveedorNombre: entities.proveedorNombre || null,
      tratamientoNombre: entities.tratamientoNombre || null,
      fechaPrestacion: entities.fechaPrestacion || null,
      fechaCobroReal: entities.fechaCobroReal || null,
      fechaVencimiento: entities.fechaVencimiento || null,
      referenciaId: entities.referenciaId || null,
      notas: entities.notas || null,
    });
  },

  // Cobro parcial con deuda residual
  // Registra dos movimientos en un solo mensaje:
  //   1. Ingreso Cobrado  por montoCobrado
  //   2. Ingreso Pendiente por montoDeuda
  cobro_parcial_con_deuda: async (ctx, entities) => {
    const userId = ctx.from.id;
    const {
      descripcion,
      montoCobrado, monedaCobrada,
      montoDeuda, monedaDeuda,
      montoTotal,
      pacienteNombre, profesionalNombre, tratamientoNombre,
      metodo_pago,
    } = entities;

    if (!montoCobrado || !montoDeuda) {
      return ctx.reply('⚠️ No pude determinar los dos montos. Intentá: `cobré 30000 y debe 30000`', { parse_mode: 'Markdown' });
    }

    const { formatMonto } = require('../utils/formatter');

    // 1. Guardar la parte cobrada
    await cmd.guardarMovimiento(userId, {
      descripcion: descripcion || 'Cobro parcial',
      monto: montoCobrado,
      tipo: 'Ingreso',
      moneda: monedaCobrada || 'Pesos',
      metodo_pago: metodo_pago || null,
      estado: 'Cobrado',
      categoria: 'cobro_pendiente',
      pacienteNombre: pacienteNombre || null,
      profesionalNombre: profesionalNombre || null,
      tratamientoNombre: tratamientoNombre || null,
    });

    // 2. Guardar la deuda restante como Pendiente
    await cmd.guardarMovimiento(userId, {
      descripcion: descripcion || 'Cobro parcial',
      monto: montoDeuda,
      tipo: 'Ingreso',
      moneda: monedaDeuda || 'Pesos',
      metodo_pago: null,
      estado: 'Pendiente',
      categoria: 'cobro_pendiente',
      pacienteNombre: pacienteNombre || null,
      profesionalNombre: profesionalNombre || null,
      tratamientoNombre: tratamientoNombre || null,
    });

    const nombreTexto = pacienteNombre ? ` — ${pacienteNombre}` : '';
    const totalTexto = montoTotal
      ? `\n📋 Total: ${formatMonto(montoTotal, monedaDeuda || 'Pesos')}`
      : '';

    return ctx.reply(
      `✅ *Cobro parcial registrado*${nombreTexto}\n\n` +
      `💰 Cobrado: ${formatMonto(montoCobrado, monedaCobrada || 'Pesos')}${metodo_pago ? ` (${metodo_pago})` : ''}\n` +
      `⏳ Pendiente: ${formatMonto(montoDeuda, monedaDeuda || 'Pesos')}` +
      `${totalTexto}\n\n` +
      `_Cuando lo cobres usá:_ \`/cobrar${pacienteNombre ? ` ${pacienteNombre}` : ' ultimo'}\``,
      { parse_mode: 'Markdown' }
    );
  },
};

async function handleNLPIntent(ctx, nlpResult) {
  const { intent, entities } = nlpResult;

  const handler = INTENT_HANDLERS[intent];
  if (!handler) {
    return false;
  }

  try {
    await handler(ctx, entities || {});
    return true;
  } catch (error) {
    console.error(`Error en handler NLP para intent "${intent}":`, error.message);
    ctx.reply('❌ Ocurrió un error al procesar tu mensaje. Intentá de nuevo o usa /ayuda.');
    return true;
  }
}

module.exports = { handleNLPIntent };
