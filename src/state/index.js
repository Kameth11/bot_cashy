const { COTIZACION_DEFAULT } = require('../config');

let cotizacionDolar = null;
let cotizacionFecha = null;

if (COTIZACION_DEFAULT) {
  cotizacionDolar = COTIZACION_DEFAULT;
  cotizacionFecha = new Date();
  console.log(`Usando cotizacion default: ${cotizacionDolar}`);
}

const pendingRegistros = new Map();
const pendingCodigos = new Map();
const pendingPayments = new Map();
const pendingIntentosEmail = new Map();
const pendingDeletes = new Map();
const pendingEdits = new Map();
const pendingCotizaciones = new Map();
const pendingLimpiezas = new Map();
const pendingReinicios = new Map();
const docsCache = new Map();

module.exports = {
  get cotizacionDolar() { return cotizacionDolar; },
  set cotizacionDolar(val) { cotizacionDolar = val; },
  get cotizacionFecha() { return cotizacionFecha; },
  set cotizacionFecha(val) { cotizacionFecha = val; },
  pendingRegistros,
  pendingCodigos,
  pendingPayments,
  pendingIntentosEmail,
  pendingDeletes,
  pendingEdits,
  pendingCotizaciones,
  pendingLimpiezas,
  pendingReinicios,
  docsCache,
};
