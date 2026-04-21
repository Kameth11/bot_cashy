const state = require('../state');

function generarIDUnico() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `mov_${timestamp}_${random}`;
}

function convertirAPesos(monto, moneda) {
  if (moneda === 'Dólares' && state.cotizacionDolar) {
    return Math.round(monto * state.cotizacionDolar * 100) / 100;
  }
  return monto;
}

module.exports = { generarIDUnico, convertirAPesos };
