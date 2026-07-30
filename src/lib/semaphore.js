// Semáforo de concurrencia en memoria, sin dependencias. Limita cuántas
// operaciones pesadas (ej: llamadas a Gemini con imágenes/audio + sharp)
// corren a la vez, para que N usuarios mandando media al mismo tiempo no
// disparen N llamadas simultáneas (memoria + CPU + rate limit del proveedor).
// Si se llena también la cola de espera, acquire() lanza un error con
// code='SEMAPHORE_QUEUE_FULL' para que el caller responda algo amable.

function createSemaphore(maxConcurrent, maxQueue = Infinity) {
  let active = 0;
  const queue = [];

  function tryNext() {
    if (active >= maxConcurrent || queue.length === 0) return;
    active += 1;
    const resolve = queue.shift();
    resolve();
  }

  async function acquire() {
    if (active < maxConcurrent) {
      active += 1;
      return;
    }
    if (queue.length >= maxQueue) {
      const err = new Error('Demasiadas operaciones en cola');
      err.code = 'SEMAPHORE_QUEUE_FULL';
      throw err;
    }
    await new Promise(resolve => queue.push(resolve));
  }

  function release() {
    if (active > 0) active -= 1;
    tryNext();
  }

  async function run(fn) {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return {
    run,
    acquire,
    release,
    get active() { return active; },
    get waiting() { return queue.length; },
  };
}

// Semáforo compartido para toda la media que va a Gemini (fotos de agenda +
// transcripción de audio). Máx 3 en vuelo, hasta 12 esperando en cola.
const geminiMediaSemaphore = createSemaphore(3, 12);

module.exports = { createSemaphore, geminiMediaSemaphore };
