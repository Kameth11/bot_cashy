// obtenerClientePorUserId real (sin mockear) devuelve null para estos IDs
// inventados (no hay clientes.json en el entorno de test), así que
// resolverKey cae al userId crudo — el comportamiento de abajo es idéntico
// al de antes del ítem 2.4 para todos los tests que no configuran el mock.
jest.mock('../src/auth', () => ({ obtenerClientePorUserId: jest.fn() }));

const { obtenerClientePorUserId } = require('../src/auth');
const { withUserWriteLock, runInBackground } = require('../src/lib/write-queue');

beforeEach(() => {
  obtenerClientePorUserId.mockReset();
});

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

  describe('ítem 2.4 — la key es el sheet (ownerId), no quien escribe', () => {
    test('el dueño y su invitado (mismo sheet) SÍ se serializan entre sí', async () => {
      // 2222 es el owner; 3333 es su invitado — ambos resuelven al mismo ownerId.
      obtenerClientePorUserId.mockImplementation((userId) => {
        if (String(userId) === '2222') return { ownerId: '2222', isOwner: true };
        if (String(userId) === '3333') return { ownerId: '2222', isOwner: false };
        return null;
      });

      const order = [];
      const first = deferred();

      const pDueno = withUserWriteLock(2222, async () => {
        await first.promise;
        order.push('dueño');
      });
      const pInvitado = withUserWriteLock(3333, async () => {
        order.push('invitado');
      });

      // El invitado escribe el MISMO sheet: tiene que esperar a que termine el dueño.
      await new Promise((r) => setTimeout(r, 10));
      expect(order).toEqual([]);

      first.resolve();
      await Promise.all([pDueno, pInvitado]);
      expect(order).toEqual(['dueño', 'invitado']);
    });

    test('dos cuentas distintas (owners distintos) NO se bloquean entre sí', async () => {
      obtenerClientePorUserId.mockImplementation((userId) => {
        if (String(userId) === '5000') return { ownerId: '5000', isOwner: true };
        if (String(userId) === '6000') return { ownerId: '6000', isOwner: true };
        return null;
      });

      const order = [];
      const slow = deferred();

      const pSlow = withUserWriteLock(5000, async () => {
        await slow.promise;
        order.push('cuenta-5000');
      });
      const pFast = withUserWriteLock(6000, async () => {
        order.push('cuenta-6000');
      });

      await pFast;
      expect(order).toEqual(['cuenta-6000']);

      slow.resolve();
      await pSlow;
      expect(order).toEqual(['cuenta-6000', 'cuenta-5000']);
    });
  });
});

describe('lib/write-queue - drenado para apagado ordenado', () => {
  const { pendientes, esperarPendientes } = require('../src/lib/write-queue');

  test('esperarPendientes espera a que terminen las escrituras en curso', async () => {
    const d = deferred();
    let terminada = false;
    withUserWriteLock('drain1', async () => { await d.promise; terminada = true; });
    expect(pendientes()).toBeGreaterThan(0);

    const espera = esperarPendientes(2000);
    d.resolve();
    expect(await espera).toBe(true);
    expect(terminada).toBe(true);
    expect(pendientes()).toBe(0);
  });

  test('esperarPendientes respeta el timeout si algo no termina', async () => {
    const d = deferred();
    withUserWriteLock('drain2', () => d.promise);
    expect(await esperarPendientes(50)).toBe(false);
    d.resolve();
    await esperarPendientes(1000);
  });

  test('sin escrituras pendientes devuelve true al instante', async () => {
    expect(await esperarPendientes(50)).toBe(true);
  });
});

describe('lib/write-queue: withOwnerWriteLock (espacios compartidos)', () => {
  const { withOwnerWriteLock } = require('../src/lib/write-queue');

  test('serializa con withUserWriteLock del dueño (misma cadena)', async () => {
    // El dueño es su propio ownerId; un miembro de otra cuenta escribe con
    // la key del dueño y no debe correr en paralelo con él.
    obtenerClientePorUserId.mockImplementation((id) => ({ ownerId: id }));
    const order = [];
    const first = deferred();

    const p1 = withUserWriteLock('77', async () => { await first.promise; order.push('dueño'); });
    const p2 = withOwnerWriteLock(77, async () => { order.push('miembro'); });

    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]);
    first.resolve();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['dueño', 'miembro']);
  });

  test('owners distintos corren en paralelo', async () => {
    const order = [];
    const slow = deferred();
    const pSlow = withOwnerWriteLock('a1', async () => { await slow.promise; order.push('a1'); });
    await withOwnerWriteLock('b1', async () => { order.push('b1'); });
    expect(order).toEqual(['b1']);
    slow.resolve();
    await pSlow;
  });

  test('un error no traba la cola y se propaga al caller', async () => {
    await expect(withOwnerWriteLock('e1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(withOwnerWriteLock('e1', async () => 'ok')).resolves.toBe('ok');
  });
});
