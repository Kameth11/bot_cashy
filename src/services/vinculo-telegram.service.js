// Pedidos de "Vincular Telegram" desde el dashboard (cuentas nacidas en la web, sin Telegram).
//
// Flujo: la persona, ya logueada en el dashboard, pide el vínculo -> se crea un pedido con un token
// de un solo uso -> abre t.me/<bot>?start=vincular_<token> -> el bot le muestra QUÉ cuenta va a
// vincular y le pide confirmar -> al confirmar, su Telegram queda ligado a esa cuenta.
//
// El pedido vive en memoria (como login-telegram.service.js: el sistema corre en una sola instancia
// y un pedido vale minutos). El token solo identifica la CUENTA que pidió el vínculo; el Telegram que
// se vincula es SIEMPRE quien toca "Sí" en el bot, nunca algo que venga en el link.

const crypto = require('crypto');

const VIGENCIA_MS = 10 * 60 * 1000;
const MAX_PEDIDOS = 500;

const pedidos = new Map(); // token -> { userId, creadaEn }

function purgar(ahora = Date.now()) {
  for (const [token, p] of pedidos) {
    if (ahora - p.creadaEn >= VIGENCIA_MS) pedidos.delete(token);
  }
}

/** Crea un pedido para la cuenta `userId`. Reemplaza al anterior de la misma cuenta (uno activo a la vez). */
function crearPedido(userId, ahora = Date.now()) {
  purgar(ahora);
  const key = String(userId);
  for (const [token, p] of pedidos) {
    if (p.userId === key) pedidos.delete(token);
  }
  if (pedidos.size >= MAX_PEDIDOS) {
    // Tope defensivo contra abuso: se descarta el más viejo.
    pedidos.delete(pedidos.keys().next().value);
  }
  const token = crypto.randomBytes(12).toString('base64url'); // 16 caracteres: entran en el payload de /start (máx. 64)
  pedidos.set(token, { userId: key, creadaEn: ahora });
  return { token, expiraEnSeg: Math.floor(VIGENCIA_MS / 1000) };
}

/** El pedido vigente para ese token, o null (inexistente, vencido o ya usado). */
function obtenerPedido(token, ahora = Date.now()) {
  const p = pedidos.get(String(token || ''));
  if (!p) return null;
  if (ahora - p.creadaEn >= VIGENCIA_MS) {
    pedidos.delete(String(token));
    return null;
  }
  return { userId: p.userId, creadaEn: p.creadaEn };
}

function consumir(token) {
  pedidos.delete(String(token || ''));
}

// Solo para tests.
function _reiniciar() { pedidos.clear(); }

module.exports = { VIGENCIA_MS, crearPedido, obtenerPedido, consumir, _reiniciar };
