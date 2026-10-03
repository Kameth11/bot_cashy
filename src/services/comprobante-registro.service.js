// Pasos finales de un comprobante, compartidos por el bot (handlers/comprobante.js)
// y el dashboard (POST /api/comprobantes): registrarlo con su archivo y, para
// una transferencia, cobrar con ella un pendiente existente.

const logger = require('../lib/logger');
const comprobanteService = require('./comprobante.service');
const archivoService = require('./comprobante-archivo.service');
const { getRowMonto, getRowMetodoPago, getRowIdUnico } = require('../utils/sheet-row');
const { formatMonto } = require('../utils/formatter');

// Sube el archivo a Storage si hay (si no, queda la referencia que traiga,
// p. ej. el file_id de Telegram), registra en la pestaña y copia a Supabase.
// Un error acá no puede deshacer ni frenar el movimiento ya guardado: se
// loguea y sigue.
//
// `respaldoTelegram`: para archivos subidos desde el dashboard, que no tienen
// file_id de Telegram. Si no se pudo subir a Storage (sin Supabase), se le
// manda el archivo por Telegram a quien lo subió y se guarda ese file_id: así
// el comprobante igual queda con su archivo (y la persona con una copia).
async function registrarComprobanteCompleto(userId, entities, { idMovimiento = null, respaldoTelegram = false } = {}) {
  const c = entities && entities.comprobante;
  if (!c || !c.id) return null;
  try {
    let archivo = c.archivo || '';
    const pendiente = archivoService.tomarArchivo(c.id);
    if (pendiente) {
      const subido = await archivoService.subirArchivo(userId, c.id, pendiente);
      if (subido) archivo = subido;
      else if (!archivo && respaldoTelegram) archivo = await enviarCopiaTelegram(userId, c, pendiente);
    }

    const datos = {
      ...c,
      archivo,
      ambito: entities.ambito === 'personal' ? 'personal' : 'consultorio',
      // Lo que el usuario corrigió en la confirmación manda sobre lo leído.
      total: entities.monto != null ? Math.abs(Number(entities.monto)) : c.total,
      moneda: entities.moneda || c.moneda,
      idMovimiento,
      cargadoPor: userId,
    };
    const id = await comprobanteService.registrarComprobante(userId, datos);
    await archivoService.guardarEnSupabase(userId, { ...datos, id });
    return id;
  } catch (err) {
    logger.error('Comprobantes', 'No se pudo registrar el comprobante', { userId, id: c.id, err: err.message });
    return null;
  }
}

async function enviarCopiaTelegram(userId, c, { buffer, mimeType }) {
  try {
    const { bot } = require('../lib/telegraf');
    const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const msg = await bot.telegram.sendDocument(Number(userId), { source: buffer, filename: `${c.id}.${ext}` }, {
      caption: '📎 Comprobante cargado desde el dashboard',
    });
    const fileId = msg && msg.document && msg.document.file_id;
    return fileId ? `tg:${fileId}` : '';
  } catch (err) {
    logger.warn('Comprobantes', 'No se pudo guardar el archivo por Telegram', { userId, id: c.id, err: err.message });
    return '';
  }
}

// Cobra `fila` (un pendiente) con la transferencia. Si la transferencia es
// menor al saldo es un cobro parcial; si es mayor, se cobra todo y se avisa
// del sobrante. Devuelve el mensaje para el usuario (Markdown).
async function cobrarPendienteConTransferencia(userId, fila, entities, { respaldoTelegram = false } = {}) {
  const cmd = require('./command.service');
  const saldo = Math.abs(getRowMonto(fila, 0));
  const parcial = entities.monto < saldo;
  const sobrante = entities.monto > saldo ? Math.round((entities.monto - saldo) * 100) / 100 : 0;

  // Cobro total: queda como cobrado por transferencia. En el parcial el
  // pendiente sigue abierto, así que no se le pone método de pago.
  if (!parcial && !getRowMetodoPago(fila, '')) fila.set('MetodoPago', 'transferencia');

  let mensaje = await cmd.ejecutarCobrarFila(userId, fila, parcial ? entities.monto : null);
  if (sobrante > 0) {
    mensaje += `\n\nℹ️ La transferencia fue ${formatMonto(sobrante, entities.moneda)} mayor al pendiente. Si el resto es otro cobro, cargalo aparte.`;
  }

  const idMovimiento = getRowIdUnico(fila, '') || null;
  await registrarComprobanteCompleto(userId, entities, { idMovimiento, respaldoTelegram });
  return { mensaje, idMovimiento, parcial, sobrante };
}

module.exports = { registrarComprobanteCompleto, cobrarPendienteConTransferencia };
