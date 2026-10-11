// A qué chat de Telegram hay que mandarle un aviso a una persona.
//
// Hay dos tipos de cuenta:
//   - Nacida en Telegram: su ID (positivo) ES su chat. Se le manda ahí.
//   - Nacida en la web por invitación: ID negativo, sin Telegram. Si después vinculó uno, el aviso
//     sale a ese Telegram; si no, no hay a dónde mandarlo (queda la campanita/push de la web).
//
// Todo `bot.telegram.sendMessage(<ID de una persona>)` tiene que pasar por acá: mandarle a un ID
// negativo falla siempre (Telegram lo toma por un grupo que no existe).

const clienteService = require('../services/cliente.service');

/** @returns {number|null} el chat al que escribirle a esa persona, o null si no tiene Telegram. */
function chatIdDe(userId) {
  const n = Number(userId);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return n;
  const vinculado = clienteService.clientes[String(userId)]?.telegramId;
  return vinculado || null;
}

module.exports = { chatIdDe };
