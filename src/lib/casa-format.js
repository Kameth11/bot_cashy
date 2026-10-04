// Formato de texto de CASA compartido entre el comando /casa y la confirmación
// de gastos (nlp-confirm). Sin I/O.

const { escapeMarkdown } = require('../utils/formatter');

function fmt(monto, moneda = 'Pesos') {
  const simbolo = moneda === 'Dólares' ? 'U$' : (moneda === 'Euros' ? '€' : '$');
  return `${simbolo}${Number(monto).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

function formatearSaldos(saldos) {
  const monedas = Object.keys(saldos || {});
  if (monedas.length === 0) return '✅ Todavía no hay gastos cargados.';

  return monedas.map((moneda) => {
    const { transferencias } = saldos[moneda];
    if (transferencias.length === 0) return `✅ ${moneda}: todo saldado`;
    const lineas = transferencias.map((t) => `• ${escapeMarkdown(t.deNombre)} → ${escapeMarkdown(t.paraNombre)}: ${fmt(t.monto, moneda)}`);
    return `⚖️ *${moneda}*\n${lineas.join('\n')}`;
  }).join('\n\n');
}

const MENSAJES_ERROR = {
  solo_duenos: '⚠️ Para usar casas necesitás tu propia cuenta: registrate con /start (no vale como invitado de un consultorio).',
  sin_cuenta: '⚠️ Tu cuenta todavía no tiene perfil propio. Registrate con /start.',
  nombre_invalido: '⚠️ El nombre tiene que tener entre 2 y 40 caracteres.',
  alias_invalido: '⚠️ El alias tiene que tener entre 2 y 40 caracteres.',
  nombre_repetido: '⚠️ Ya existe uno con ese nombre. Probá con otro.',
  no_miembro: '🔒 No pertenecés a esa casa.',
  casa_inexistente: '⚠️ Esa casa ya no existe.',
  ya_miembro: '⚠️ Ya pertenecés a esa casa.',
  miembro_no_disponible: '⚠️ Esa invitación ya no está disponible.',
  solo_creador: '🔒 Solo quien creó la casa puede quitar miembros.',
  no_se_puede_quitar_creador: '⚠️ No se puede quitar a quien creó la casa.',
  saldo_pendiente: '⚠️ Tiene saldo pendiente: liquidá antes (`/casa saldar`).',
  miembro_inexistente: '⚠️ No encontré a ese miembro.',
  monto_invalido: '⚠️ El monto no es válido.',
  moneda_invalida: '⚠️ Moneda no soportada (Pesos, Dólares o Euros).',
  liquidacion_invalida: '⚠️ No podés pagarte a vos mismo.',
  destinatario_invalido: '⚠️ Ese miembro no pertenece a la casa.',
  pagador_invalido: '⚠️ Ese miembro no pertenece a la casa.',
  reparto_invalido: '⚠️ Alguien del reparto no pertenece a la casa.',
  descripcion_invalida: '⚠️ Falta una descripción más clara. Mandalo de nuevo.',
  sin_sheet: '⚠️ No pude acceder al sheet. Probá de nuevo en un rato.',
};

function mensajeError(err) {
  return MENSAJES_ERROR[err && err.code] || '❌ Algo salió mal. Probá de nuevo.';
}

// Mismo mensaje sin emojis ni Markdown, para la API / el dashboard.
function mensajeErrorPlano(err) {
  return mensajeError(err).replace(/^[^\p{L}¿¡]+/u, '').replace(/[`*_]/g, '');
}


module.exports = { fmt, formatearSaldos, mensajeError, mensajeErrorPlano, MENSAJES_ERROR };
