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
  return texto.slice(0, maxLength).replace(/[<>"'&]/g, '').trim();
}

function esMonedaValida(moneda) {
  return ['$', 'U$', 'USD'].includes(moneda);
}

module.exports = { formatFecha, formatMonto, sanitizarInput, esMonedaValida };
