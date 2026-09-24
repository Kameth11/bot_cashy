const { obtenerClientePorUserId } = require('../auth');

// Cola de escritura por sheet: serializa operaciones async para una misma
// key, dejando que keys distintas corran en paralelo.
//
// La key es el ownerId de la cuenta, no el userId de quien escribe: el
// dueño y sus invitados comparten el mismo Google Sheet (ver
// src/auth/index.js), así que si cada uno tuviera su propio lock, una
// escritura del dueño y una de un invitado al mismo sheet podían pisarse en
// paralelo en vez de serializarse.
function resolverKey(userId) {
  const cliente = obtenerClientePorUserId(userId);
  return String(cliente ? cliente.ownerId : userId);
}

const tails = new Map(); // ownerId -> promise "tail" de la cadena actual

function withUserWriteLock(userId, fn) {
  const key = resolverKey(userId);
  const previous = tails.get(key) || Promise.resolve();

  // .then(fn, fn): corre fn aunque la anterior haya fallado, para que un
  // error no deje la cola de ese usuario trabada para siempre.
  const run = previous.then(fn, fn);
  const settled = run.then(() => {}, () => {});
  tails.set(key, settled);

  // Si nadie encadeno algo nuevo mientras corria, borramos la entrada.
  settled.then(() => {
    if (tails.get(key) === settled) tails.delete(key);
  });

  return run; // el caller ve el resultado/error real de fn, sin envolver
}

// Corre `fn` bajo el lock de escritura del usuario pero SIN bloquear al caller:
// devuelve de inmediato y deja la operación corriendo en background. Sirve para
// trabajo best-effort que no debe demorar la respuesta al usuario (ej: el
// dual-write a Google Sheets cuando Supabase ya es la fuente de verdad). Los
// errores se loguean, nunca se propagan (no hay nadie esperándolos).
function runInBackground(userId, fn, label = 'background') {
  withUserWriteLock(userId, fn).catch(err => {
    console.error(`runInBackground[${label}] error (userId=${userId}):`, err && err.message ? err.message : err);
  });
}

module.exports = { withUserWriteLock, runInBackground };
