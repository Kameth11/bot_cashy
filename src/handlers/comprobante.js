// Comprobantes leídos de fotos/PDFs (ver PLAN_COMPROBANTES.md).
//
// La foto ya llegó clasificada desde handlers/photo.js. Acá se extraen los
// datos, se arman las mismas `entities` que el NLP de texto y se reusa la
// confirmación de nlp-confirm.js (editar campos, cambiar de ámbito). El
// comprobante se registra en la pestaña Comprobantes al tocar "Guardar"
// (ver registrarComprobanteDesdeEntities, llamado desde handleNlpSave).

const { Markup } = require('telegraf');
const { bot } = require('../lib/telegraf');
const { geminiMediaSemaphore } = require('../lib/semaphore');
const logger = require('../lib/logger');
const state = require('../state');
const comprobanteService = require('../services/comprobante.service');
const archivoService = require('../services/comprobante-archivo.service');
const registro = require('../services/comprobante-registro.service');
const cmd = require('../services/command.service');
const { getRowDescripcion, getRowMonto, getRowMoneda } = require('../utils/sheet-row');
const { formatMonto, escapeMarkdown } = require('../utils/formatter');

async function procesarFactura(ctx, archivo) {
  const userId = ctx.from.id;
  const { extraerFactura } = require('../services/comprobante-vision.service');

  const hash = comprobanteService.hashArchivo(archivo.buffer);
  const resultado = await geminiMediaSemaphore.run(() => extraerFactura(archivo.buffer, archivo.mimeType));

  if (!resultado) return ctx.reply('❌ No pude leer el comprobante. Probá con una foto más clara y derecha.');
  if (resultado.error === 'vision_no_configurada') return ctx.reply('⚠️ La lectura de imágenes no está configurada. Revisá `GEMINI_API_KEY`.');
  if (resultado.error === 'vision_dependencia_faltante') return ctx.reply('⚠️ Falta instalar la dependencia de Vision. Revisá `@google/generative-ai`.');
  if (resultado.error === 'no_es_comprobante') {
    return ctx.reply('⚠️ No parece una factura ni un ticket. Si es un gasto, probá con una foto más clara o escribilo, por ejemplo: `gasté 5000 en insumos`.', { parse_mode: 'Markdown' });
  }

  const factura = resultado.factura;
  if (!factura.total) {
    return ctx.reply('⚠️ Leí el comprobante pero no encontré el total. Probá con una foto donde se vea el importe, o escribilo: `gasté 5000 en insumos`.', { parse_mode: 'Markdown' });
  }

  const duplicado = await comprobanteService.buscarDuplicado(userId, {
    hash, cuit: factura.cuit, emisor: factura.emisor, numero: factura.numero, total: factura.total,
  });

  const idComprobante = comprobanteService.generarIdComprobante();
  const entities = comprobanteService.facturaAEntities(factura, {
    idComprobante,
    duplicado: duplicado ? { motivo: duplicado.motivo, fechaCarga: duplicado.comprobante.fechaCarga } : null,
  });
  entities.comprobante.hash = hash;
  entities.comprobante.archivo = archivo.fileId ? `tg:${archivo.fileId}` : '';
  entities.comprobante.mimeType = archivo.mimeType;
  archivoService.recordarArchivo(idComprobante, archivo);

  // Mismo detector de ámbito que el texto libre (y misma regla: un invitado
  // nunca carga en Personal). El rubro/emisor ("supermercado", "YPF") es la
  // mejor señal.
  const { marcarAmbito } = require('./text');
  const conAmbito = await marcarAmbito(userId, comprobanteService.textoParaAmbito(factura), {
    intent: 'registrar_movimiento',
    entities,
  });

  logger.info('Comprobantes', 'Factura leída', {
    userId, idComprobante, ambito: conAmbito.entities.ambito, duplicado: duplicado?.motivo || null,
  });

  const { mostrarConfirmacion } = require('./nlp-confirm');
  return mostrarConfirmacion(ctx, conAmbito.entities);
}

// ── Transferencias de pacientes (fase 2 de PLAN_COMPROBANTES.md) ─────────────
//
// Se lee quién pagó y cuánto. Si hay pendientes que parecen de esa persona se
// ofrece cobrarlos (cobro parcial si la transferencia es menor al saldo); si
// no, o si el usuario lo prefiere, se carga como ingreso nuevo por la misma
// confirmación de siempre. Nunca se cobra nada sin que el usuario toque un botón.

async function procesarTransferencia(ctx, archivo) {
  const userId = ctx.from.id;
  const { extraerTransferencia } = require('../services/comprobante-vision.service');

  const hash = comprobanteService.hashArchivo(archivo.buffer);
  const resultado = await geminiMediaSemaphore.run(() => extraerTransferencia(archivo.buffer, archivo.mimeType));

  if (!resultado) return ctx.reply('❌ No pude leer el comprobante. Probá con una captura más clara.');
  if (resultado.error === 'vision_no_configurada') return ctx.reply('⚠️ La lectura de imágenes no está configurada. Revisá `GEMINI_API_KEY`.');
  if (resultado.error === 'vision_dependencia_faltante') return ctx.reply('⚠️ Falta instalar la dependencia de Vision. Revisá `@google/generative-ai`.');
  if (resultado.error === 'no_es_transferencia') {
    return ctx.reply('⚠️ No parece un comprobante de transferencia. Si es un cobro, escribilo, por ejemplo: `cobré 30000 de Juan por transferencia`.', { parse_mode: 'Markdown' });
  }

  const t = resultado.transferencia;
  if (!t.monto) {
    return ctx.reply('⚠️ Leí el comprobante pero no encontré el monto. Probá con una captura donde se vea el importe, o escribilo: `cobré 30000 de Juan por transferencia`.', { parse_mode: 'Markdown' });
  }

  const duplicado = await comprobanteService.buscarDuplicado(userId, {
    hash, cuit: t.cuitPagador, emisor: t.pagador, numero: t.numeroOperacion, total: t.monto,
  });

  const idComprobante = comprobanteService.generarIdComprobante();
  const entities = comprobanteService.transferenciaAEntities(t, {
    idComprobante,
    hash,
    archivo: archivo.fileId ? `tg:${archivo.fileId}` : '',
    mimeType: archivo.mimeType,
    duplicado: duplicado ? { motivo: duplicado.motivo, fechaCarga: duplicado.comprobante.fechaCarga } : null,
  });
  archivoService.recordarArchivo(idComprobante, archivo);

  let pendientes = [];
  try {
    pendientes = await cmd.buscarPendientesDePagador(userId, t.pagador, { moneda: t.moneda });
  } catch (err) {
    logger.warn('Comprobantes', 'No se pudieron buscar pendientes del pagador', { userId, err: err.message });
  }

  logger.info('Comprobantes', 'Transferencia leída', {
    userId, idComprobante, pendientes: pendientes.length, duplicado: duplicado?.motivo || null,
  });

  const { mostrarConfirmacion } = require('./nlp-confirm');
  if (pendientes.length === 0) return mostrarConfirmacion(ctx, entities);

  const monto = formatMonto(t.monto, t.moneda);
  const lineas = [
    '💸 *Transferencia leída*',
    '',
    `👤 ${escapeMarkdown(t.pagador || 'Sin nombre')}`,
    `💰 ${monto}`,
  ];
  if (t.fecha) lineas.push(`📅 ${t.fecha}`);
  if (t.banco || t.numeroOperacion) {
    lineas.push(`🏦 ${escapeMarkdown([t.banco, t.numeroOperacion && `op. ${t.numeroOperacion}`].filter(Boolean).join(' · '))}`);
  }
  if (duplicado) lineas.push('', '⚠️ *Ojo:* este comprobante parece ya cargado antes.');
  lineas.push('', '⏳ Encontré pendientes que podrían ser de esta persona. ¿Cuál cobro?');

  const botones = pendientes.map((f, i) => {
    const desc = getRowDescripcion(f, '');
    const label = `${desc.length > 22 ? desc.substring(0, 22) + '…' : desc} · ${formatMonto(getRowMonto(f, 0), getRowMoneda(f, 'Pesos'))}`;
    return [Markup.button.callback(label, `transf_cobrar_${i}`)];
  });
  botones.push([Markup.button.callback('➕ Cargar como ingreso nuevo', 'transf_nuevo')]);
  botones.push([Markup.button.callback('❌ Cancelar', 'transf_cancel')]);

  await ctx.reply(lineas.join('\n'), { parse_mode: 'Markdown', ...Markup.inlineKeyboard(botones) });
  // El estado se setea recién después de que el mensaje salió bien.
  state.pendingTransferencias.set(userId, { entities, filas: pendientes });
}

bot.action(/^transf_cobrar_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingTransferencias.get(userId);
  if (!pending) return ctx.editMessageText('⚠️ Sesión expirada. Mandá la foto de nuevo.');

  const fila = pending.filas[Number(ctx.match[1])];
  if (!fila) return ctx.editMessageText('❌ Elemento no encontrado.');
  state.pendingTransferencias.delete(userId);

  try {
    const { mensaje } = await registro.cobrarPendienteConTransferencia(userId, fila, pending.entities);
    return ctx.editMessageText(mensaje, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error('Comprobantes', 'Error al cobrar con transferencia', { userId, err: err.message });
    return ctx.editMessageText('❌ Error al cobrar. Intentá de nuevo.');
  }
});

bot.action('transf_nuevo', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const pending = state.pendingTransferencias.get(userId);
  if (!pending) return ctx.editMessageText('⚠️ Sesión expirada. Mandá la foto de nuevo.');
  state.pendingTransferencias.delete(userId);

  await ctx.editMessageText('➕ La cargo como ingreso nuevo.').catch(() => {});
  const { mostrarConfirmacion } = require('./nlp-confirm');
  return mostrarConfirmacion(ctx, pending.entities);
});

bot.action('transf_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  state.pendingTransferencias.delete(ctx.from.id);
  return ctx.editMessageText('❌ Cancelado.');
});

// Se llama al guardar el movimiento (nlp-confirm.js). La lógica vive en
// comprobante-registro.service, compartida con el dashboard.
function registrarComprobanteDesdeEntities(userId, entities, opts) {
  return registro.registrarComprobanteCompleto(userId, entities, opts);
}

module.exports = { procesarFactura, procesarTransferencia, registrarComprobanteDesdeEntities };
