// ¿Puede esta persona usar el ámbito Personal?
//
//   - Modo 'sheets': solo el dueño de la cuenta o el admin (un agregado usaría las
//     pestañas del sheet del dueño: ver ARCHITECTURE.md, decisión 2026-09-23).
//   - Modo 'supabase': cualquier usuario registrado, con SU propio Personal. El dato
//     se separa por user_id (lib/persona-db.js), no por sheet.
//
// Un único criterio para el bot, la API y el dashboard.

const { esAdminOriginal, obtenerClientePorUserId } = require('./index');
const { personalEnSupabase } = require('../lib/personal-store');

function esDuenoOAdmin(userId) {
  if (esAdminOriginal(userId)) return true;
  const cliente = obtenerClientePorUserId(userId);
  return Boolean(cliente && cliente.isOwner);
}

function puedeUsarPersonal(userId) {
  if (esDuenoOAdmin(userId)) return true;
  if (!personalEnSupabase()) return false;
  return Boolean(obtenerClientePorUserId(userId));
}

module.exports = { puedeUsarPersonal, esDuenoOAdmin };
