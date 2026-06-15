const eventsService = require('../src/services/events.service');

function mockRes() {
  return { write: jest.fn() };
}

describe('events.service - aislamiento multi-tenant', () => {
  afterEach(() => {
    // Limpieza defensiva: desuscribir cualquier res que haya quedado de un test anterior.
    jest.restoreAllMocks();
  });

  test('emitMovimientosUpdated solo notifica a las conexiones del mismo userId', () => {
    const resA = mockRes();
    const resB = mockRes();

    eventsService.subscribe('111', resA);
    eventsService.subscribe('222', resB);

    eventsService.emitMovimientosUpdated('111');

    expect(resA.write).toHaveBeenCalledTimes(1);
    expect(resA.write).toHaveBeenCalledWith(expect.stringContaining('event: movimientos_updated'));
    expect(resB.write).not.toHaveBeenCalled();

    eventsService.unsubscribe('111', resA);
    eventsService.unsubscribe('222', resB);
  });

  test('userId numerico y string apuntan al mismo canal (se normaliza con String())', () => {
    const res = mockRes();
    eventsService.subscribe(333, res);

    eventsService.emitMovimientosUpdated('333');

    expect(res.write).toHaveBeenCalledTimes(1);
    eventsService.unsubscribe(333, res);
  });

  test('emitMovimientosUpdated para un userId sin suscriptores no lanza error', () => {
    expect(() => eventsService.emitMovimientosUpdated('sin-suscriptores')).not.toThrow();
  });

  test('unsubscribe detiene las notificaciones futuras', () => {
    const res = mockRes();
    eventsService.subscribe('444', res);
    eventsService.unsubscribe('444', res);

    eventsService.emitMovimientosUpdated('444');

    expect(res.write).not.toHaveBeenCalled();
  });

  test('una conexion que lanza al escribir (cliente desconectado) no rompe a las demas', () => {
    const resRoto = { write: jest.fn(() => { throw new Error('socket cerrado'); }) };
    const resOk = mockRes();

    eventsService.subscribe('555', resRoto);
    eventsService.subscribe('555', resOk);

    expect(() => eventsService.emitMovimientosUpdated('555')).not.toThrow();
    expect(resOk.write).toHaveBeenCalledTimes(1);

    eventsService.unsubscribe('555', resRoto);
    eventsService.unsubscribe('555', resOk);
  });

  test('onMovimientosUpdated registra listeners que se ejecutan antes de notificar a los clientes', () => {
    const llamadas = [];
    eventsService.onMovimientosUpdated((userId) => llamadas.push(userId));

    eventsService.emitMovimientosUpdated('666');

    expect(llamadas).toContain('666');
  });

  test('un listener que lanza error no rompe la emision hacia los clientes SSE', () => {
    eventsService.onMovimientosUpdated(() => { throw new Error('listener roto'); });

    const res = mockRes();
    eventsService.subscribe('777', res);

    expect(() => eventsService.emitMovimientosUpdated('777')).not.toThrow();
    expect(res.write).toHaveBeenCalledTimes(1);

    eventsService.unsubscribe('777', res);
  });
});
