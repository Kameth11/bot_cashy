// Cola de escritura por usuario: serializa operaciones async para una misma
// key, dejando que keys distintas corran en paralelo. Sin dependencias externas.

const tails = new Map(); // userId -> promise "tail" de la cadena actual

function withUserWriteLock(userId, fn) {
  const key = String(userId);
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

module.exports = { withUserWriteLock };
