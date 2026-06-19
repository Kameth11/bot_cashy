// Limiter en memoria con expiración perezosa (sin timers por entrada).
// Pensado para rutas de auth de bajo volumen, no para uso de alta concurrencia.

function createLimiter({ windowMs, max }) {
  const hits = new Map();
  return function checkAndConsume(key) {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true };
    }
    if (entry.count >= max) return { allowed: false };
    entry.count += 1;
    return { allowed: true };
  };
}

module.exports = { createLimiter };
