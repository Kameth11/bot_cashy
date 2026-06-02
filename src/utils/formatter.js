function formatFecha(fechaStr) {
  if (!fechaStr) return '';

  if (fechaStr instanceof Date && !Number.isNaN(fechaStr.getTime())) {
    return `${String(fechaStr.getDate()).padStart(2, '0')}/${String(fechaStr.getMonth() + 1).padStart(2, '0')}/${fechaStr.getFullYear()}`;
  }

  const raw = String(fechaStr).trim();
  if (!raw) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
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
