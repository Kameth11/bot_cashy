const { createSemaphore } = require('../src/lib/semaphore');

const tick = () => new Promise(r => setImmediate(r));

describe('createSemaphore', () => {
  test('limita la concurrencia al máximo configurado', async () => {
    const sem = createSemaphore(2, 10);
    let running = 0;
    let maxRunning = 0;

    const release = [];
    const tarea = () => sem.run(() => new Promise(resolve => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      release.push(() => { running -= 1; resolve(); });
    }));

    const tareas = [tarea(), tarea(), tarea(), tarea()];
    await tick();

    // Solo 2 corren a la vez; las otras 2 esperan.
    expect(sem.active).toBe(2);
    expect(sem.waiting).toBe(2);

    // Liberamos de a una y dejamos que avance la cola.
    while (release.length) {
      release.shift()();
      await tick();
    }
    await Promise.all(tareas);

    expect(maxRunning).toBe(2);
    expect(sem.active).toBe(0);
    expect(sem.waiting).toBe(0);
  });

  test('rechaza con SEMAPHORE_QUEUE_FULL cuando la cola está llena', async () => {
    const sem = createSemaphore(1, 1);
    const bloqueantes = [];
    const ocupar = () => sem.run(() => new Promise(resolve => bloqueantes.push(resolve)));

    ocupar();          // toma el único slot activo
    const enCola = ocupar(); // ocupa el único lugar de cola
    await tick();

    // Tercera: no hay slot ni lugar en cola -> error.
    await expect(sem.run(() => Promise.resolve('ok'))).rejects.toMatchObject({
      code: 'SEMAPHORE_QUEUE_FULL',
    });

    // Drenamos: cada tarea liberada deja correr a la siguiente de la cola, que
    // a su vez agrega su propio resolver a `bloqueantes`.
    while (bloqueantes.length) {
      bloqueantes.shift()();
      await tick();
    }
    await enCola;
  });

  test('libera el slot aunque la tarea falle', async () => {
    const sem = createSemaphore(1, 5);
    await expect(sem.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(sem.active).toBe(0);
    // El slot quedó libre para la siguiente.
    await expect(sem.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
