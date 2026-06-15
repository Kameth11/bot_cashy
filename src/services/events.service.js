// Pub/sub en memoria para notificar al dashboard (via SSE) cuando cambian los
// movimientos de un usuario, sin importar si el cambio vino del bot o del propio
// dashboard. Cada conexion SSE se registra por userId (string) y recibe un evento
// "movimientos_updated" cada vez que se crea/edita/borra un movimiento de ese usuario.

const subscribers = new Map(); // userId (string) -> Set<res>
const listeners = new Set();   // funciones(userId) llamadas antes de notificar a los clientes

function subscribe(userId, res) {
  const key = String(userId);
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key).add(res);
}

function unsubscribe(userId, res) {
  const key = String(userId);
  const set = subscribers.get(key);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) subscribers.delete(key);
}

// Permite que otros modulos (ej. la cache de /api/movimientos) se enteren de
// cambios sin crear una dependencia circular con db.service.js.
function onMovimientosUpdated(fn) {
  listeners.add(fn);
}

function emitMovimientosUpdated(userId) {
  for (const fn of listeners) {
    try { fn(userId); } catch (e) { console.error('events.service listener error:', e.message); }
  }

  const set = subscribers.get(String(userId));
  if (!set) return;
  for (const res of set) {
    try {
      res.write('event: movimientos_updated\ndata: {}\n\n');
    } catch (e) {
      // conexion rota, se limpiara via 'close'
    }
  }
}

module.exports = { subscribe, unsubscribe, onMovimientosUpdated, emitMovimientosUpdated };
