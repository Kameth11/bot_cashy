function formatFecha(fechaStr) {
  if (!fechaStr) return '';
  return fechaStr;
}

function formatMonto(monto, moneda) {
  const monedaSimbolo = moneda === 'Dólares' ? 'U$' : '$';
  const montoAbs = Math.abs(monto);
  return monto < 0 ? `-${monedaSimbolo}${montoAbs.toLocaleString()}` : `${monedaSimbolo}${montoAbs.toLocaleString()}`;
}

function sanitizarInput(texto, maxLength = 200) {
  if (!texto || typeof texto !== 'string') return '';
  return texto
    .slice(0, maxLength)
    .replace(/[<>"'&`]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function esMonedaValida(moneda) {
  return ['$', 'U$', 'USD'].includes(moneda);
}

function escapeMarkdown(texto) {
  if (texto == null) return '';
  return String(texto).replace(/([_*\[\]()`])/g, '\\$1');
}

module.exports = { formatFecha, formatMonto, sanitizarInput, esMonedaValida, escapeMarkdown };
