const { COTIZACION_DEFAULT } = require('../config');

let cotizacionDolar = null;
let cotizacionFecha = null;

if (COTIZACION_DEFAULT) {
  cotizacionDolar = COTIZACION_DEFAULT;
  cotizacionFecha = new Date();
  console.log(`Usando cotizacion default: ${cotizacionDolar}`);
}

// Map con TTL automático. Si el usuario no completa un flujo en `ttlMs`,
// la entrada expira sola y no queda "colgado".
class TTLMap {
  constructor(ttlMs = 30 * 60 * 1000) {
    this._map = new Map();
    this._ttl = ttlMs;
  }

  set(key, value) {
    if (this._map.has(key)) {
      clearTimeout(this._map.get(key)._timer);
    }
    const timer = setTimeout(() => this._map.delete(key), this._ttl);
    // Permite que el proceso cierre sin esperar el timer
    if (timer.unref) timer.unref();
    this._map.set(key, { value, _timer: timer });
  }

  get(key) {
    return this._map.has(key) ? this._map.get(key).value : undefined;
  }

  has(key) {
    return this._map.has(key);
  }

  delete(key) {
    if (this._map.has(key)) {
      clearTimeout(this._map.get(key)._timer);
      this._map.delete(key);
    }
  }

  get size() {
    return this._map.size;
  }
}

// Flujos de conversación pendientes — expiran a los 30 minutos
const pendingRegistros      = new TTLMap();
const pendingCodigos        = new TTLMap();
const pendingPayments       = new TTLMap();
const pendingIntentosEmail  = new TTLMap();
const pendingDeletes        = new TTLMap();
const pendingEdits          = new TTLMap();
const pendingCotizaciones   = new TTLMap();
const pendingLimpiezas      = new TTLMap();
const pendingReinicios      = new TTLMap();
const pendingDescripcion    = new TTLMap();
const pendingAgendaConfirm  = new TTLMap();
const pendingIngresoPacientes = new TTLMap();

// Cache de documentos — TTL más largo (2 horas)
const docsCache = new TTLMap(2 * 60 * 60 * 1000);

// Rate limits — ventana de 1 minuto
const userRateLimits = new Map();

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
  pendingDescripcion,
  pendingAgendaConfirm,
  pendingIngresoPacientes,
  docsCache,
  userRateLimits,
};
