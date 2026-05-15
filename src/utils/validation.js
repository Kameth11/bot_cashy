const {
  MAX_DESCRIPCION_LENGTH,
  MAX_MOVIMIENTO_MONTO,
  MAX_COTIZACION_DOLAR,
  MAX_TEXT_LENGTH,
} = require('../config');
const { sanitizarInput } = require('./formatter');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHEET_ID_REGEX = /^[a-zA-Z0-9-_]{20,120}$/;

function validarTextoUsuario(texto) {
  if (typeof texto !== 'string') return { ok: false, motivo: 'texto_invalido' };
  if (texto.length === 0 || texto.length > MAX_TEXT_LENGTH) return { ok: false, motivo: 'texto_largo' };
  return { ok: true };
}

function normalizarDescripcion(texto) {
  const descripcion = sanitizarInput(texto, MAX_DESCRIPCION_LENGTH);
  if (descripcion.length < 2) return { ok: false, motivo: 'descripcion_invalida' };
  return { ok: true, valor: descripcion };
}

function validarMonto(valor) {
  const monto = typeof valor === 'number' ? valor : parseFloat(valor);
  if (!Number.isFinite(monto) || monto === 0 || Math.abs(monto) > MAX_MOVIMIENTO_MONTO) {
    return { ok: false, motivo: 'monto_invalido' };
  }
  return { ok: true, valor: monto };
}

function validarCotizacion(valor) {
  const cotizacion = typeof valor === 'number' ? valor : parseFloat(valor);
  if (!Number.isFinite(cotizacion) || cotizacion <= 0 || cotizacion > MAX_COTIZACION_DOLAR) {
    return { ok: false, motivo: 'cotizacion_invalida' };
  }
  return { ok: true, valor: cotizacion };
}

function validarEmail(email) {
  const normalizado = String(email || '').trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalizado) || normalizado.length > 160) {
    return { ok: false, motivo: 'email_invalido' };
  }
  return { ok: true, valor: normalizado };
}

function validarSheetId(sheetId) {
  const normalizado = String(sheetId || '').trim();
  if (!SHEET_ID_REGEX.test(normalizado)) {
    return { ok: false, motivo: 'sheet_id_invalido' };
  }
  return { ok: true, valor: normalizado };
}

module.exports = {
  validarTextoUsuario,
  normalizarDescripcion,
  validarMonto,
  validarCotizacion,
  validarEmail,
  validarSheetId,
};
