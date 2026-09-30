// Comprobantes leídos de fotos/PDFs (ver PLAN_COMPROBANTES.md).
//
// La foto ya llegó clasificada desde handlers/photo.js. Acá se extraen los
// datos, se arman las mismas `entities` que el NLP de texto y se reusa la
// confirmación de nlp-confirm.js (editar campos, cambiar de ámbito). El
// comprobante se registra en la pestaña Comprobantes al tocar "Guardar"
// (ver registrarComprobanteDesdeEntities, llamado desde handleNlpSave).

const { geminiMediaSemaphore } = require('../lib/semaphore');
const logger = require('../lib/logger');
const comprobanteService = require('../services/comprobante.service');

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

// Fase 2 de PLAN_COMPROBANTES.md.
async function procesarTransferencia(ctx) {
  return ctx.reply('💸 Todavía no leo comprobantes de transferencia (llega en la próxima versión). Por ahora cargalo como texto, por ejemplo: `cobré 30000 de Juan por transferencia`.', { parse_mode: 'Markdown' });
}

// Se llama al guardar el movimiento (nlp-confirm.js). Un error acá no puede
// deshacer ni frenar el movimiento ya guardado: se loguea y sigue.
async function registrarComprobanteDesdeEntities(userId, entities, { idMovimiento = null } = {}) {
  const c = entities && entities.comprobante;
  if (!c || !c.id) return null;
  try {
    return await comprobanteService.registrarComprobante(userId, {
      ...c,
      ambito: entities.ambito === 'personal' ? 'personal' : 'consultorio',
      // Lo que el usuario corrigió en la confirmación manda sobre lo leído.
      total: entities.monto != null ? Math.abs(Number(entities.monto)) : c.total,
      moneda: entities.moneda || c.moneda,
      idMovimiento,
      cargadoPor: userId,
    });
  } catch (err) {
    logger.error('Comprobantes', 'No se pudo registrar el comprobante', { userId, id: c.id, err: err.message });
    return null;
  }
}

module.exports = { procesarFactura, procesarTransferencia, registrarComprobanteDesdeEntities };
