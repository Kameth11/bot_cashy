const { withUserWriteLock, runInBackground } = require('../src/lib/write-queue');

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

describe('lib/write-queue', () => {
  test('mismo userId: la segunda llamada espera a que termine la primera', async () => {
    const order = [];
    const first = deferred();

    const p1 = withUserWriteLock('1', async () => {
      await first.promise;
      order.push('first');
    });
    const p2 = withUserWriteLock('1', async () => {
      order.push('second');
    });

    // todavia no resolvimos "first", asi que "second" no deberia haber corrido
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]);

    first.resolve();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['first', 'second']);
  });

  test('userIds distintos no se bloquean entre si', async () => {
    const order = [];
    const slow = deferred();

    const pSlow = withUserWriteLock('a', async () => {
      await slow.promise;
      order.push('a');
    });
    const pFast = withUserWriteLock('b', async () => {
      order.push('b');
    });

    await pFast;
    expect(order).toEqual(['b']);

    slow.resolve();
    await pSlow;
    expect(order).toEqual(['b', 'a']);
  });

  test('un fallo no traba la cola para el mismo usuario', async () => {
    const order = [];

    const p1 = withUserWriteLock('x', async () => {
      order.push('first');
      throw new Error('boom');
    });
    const p2 = withUserWriteLock('x', async () => {
      order.push('second');
      return 'ok';
    });

    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('ok');
    expect(order).toEqual(['first', 'second']);
  });

  test('propaga el valor de retorno sin envolver', async () => {
    const result = await withUserWriteLock('y', async () => 42);
    expect(result).toBe(42);
  });

  describe('runInBackground', () => {
    test('no bloquea al caller: retorna ya y corre despues', async () => {
      let corrio = false;
      const ret = runInBackground('bg1', async () => { corrio = true; });

      // No devuelve una promesa que el caller deba esperar, y todavia no corrio.
      expect(ret).toBeUndefined();
      expect(corrio).toBe(false);

      await new Promise((r) => setTimeout(r, 0));
      expect(corrio).toBe(true);
    });

    test('corre bajo el lock del usuario: espera al lock activo', async () => {
      const order = [];
      const gate = deferred();

      const held = withUserWriteLock('bg2', async () => {
        await gate.promise;
        order.push('held');
      });
      runInBackground('bg2', async () => { order.push('bg'); });

      // Mientras el lock siga tomado, el trabajo en background no arranca.
      await new Promise((r) => setTimeout(r, 10));
      expect(order).toEqual([]);

      gate.resolve();
      await held;
      await new Promise((r) => setTimeout(r, 0));
      expect(order).toEqual(['held', 'bg']);
    });

    test('traga el error: no lanza ni deja una promesa colgada sin manejar', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => runInBackground('bg3', async () => { throw new Error('boom'); }, 'tarea')).not.toThrow();
      await new Promise((r) => setTimeout(r, 0));

      expect(spy).toHaveBeenCalled();
      // Y el lock del usuario queda libre para la siguiente operacion.
      await expect(withUserWriteLock('bg3', async () => 'ok')).resolves.toBe('ok');

      spy.mockRestore();
    });
  });
});
