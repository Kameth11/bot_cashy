const { lanzarBot, esConflicto, ESPERA_MS, INTENTOS_HASTA_ERROR } = require('../src/lib/lanzar-bot');

const conflicto409 = () => Object.assign(new Error('409: Conflict: terminated by other getUpdates request; make sure that only one bot instance is running'), { code: 409, response: { error_code: 409 } });
const logger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
const esperar = () => jest.fn().mockResolvedValue(undefined);

test('esConflicto reconoce el 409 de Telegraf y nada más', () => {
  expect(esConflicto(conflicto409())).toBe(true);
  expect(esConflicto({ response: { error_code: 409 } })).toBe(true);
  expect(esConflicto(Object.assign(new Error('x'), { code: 401 }))).toBe(false);
  expect(esConflicto(new Error('x'))).toBe(false);
  expect(esConflicto(null)).toBe(false);
});

test('arranca sin problemas: un solo launch, y se le pasa alConectar', async () => {
  const launch = jest.fn().mockResolvedValue(undefined);
  const alConectar = jest.fn();
  await lanzarBot({ launch, alConectar, logger: logger(), esperar: esperar() });
  expect(launch).toHaveBeenCalledTimes(1);
  expect(launch).toHaveBeenCalledWith(alConectar);
});

test('un 409 (deploy con la instancia vieja viva) se reintenta hasta que entra, solo con warn', async () => {
  const launch = jest.fn()
    .mockRejectedValueOnce(conflicto409())
    .mockRejectedValueOnce(conflicto409())
    .mockResolvedValueOnce(undefined);
  const log = logger();
  const espera = esperar();
  await lanzarBot({ launch, alConectar: jest.fn(), logger: log, esperar: espera });

  expect(launch).toHaveBeenCalledTimes(3);
  expect(espera).toHaveBeenCalledTimes(2);
  expect(espera).toHaveBeenCalledWith(ESPERA_MS);
  expect(log.warn).toHaveBeenCalledTimes(2);
  expect(log.error).not.toHaveBeenCalled(); // no avisa por Discord: es lo normal en un deploy
});

test('si el 409 dura más de ~1 minuto avisa UNA vez como error y sigue reintentando', async () => {
  const total = INTENTOS_HASTA_ERROR + 5;
  const launch = jest.fn();
  for (let i = 0; i < total; i++) launch.mockRejectedValueOnce(conflicto409());
  launch.mockResolvedValueOnce(undefined);
  const log = logger();
  await lanzarBot({ launch, alConectar: jest.fn(), logger: log, esperar: esperar() });

  expect(launch).toHaveBeenCalledTimes(total + 1);
  expect(log.error).toHaveBeenCalledTimes(1);
  expect(log.error.mock.calls[0][1]).toContain('otra copia');
});

test('un error que no es 409 se propaga (no se reintenta a ciegas)', async () => {
  const err = Object.assign(new Error('401: Unauthorized'), { code: 401 });
  const launch = jest.fn().mockRejectedValue(err);
  await expect(lanzarBot({ launch, alConectar: jest.fn(), logger: logger(), esperar: esperar() })).rejects.toBe(err);
  expect(launch).toHaveBeenCalledTimes(1);
});

test('si se está apagando, deja de reintentar sin error', async () => {
  let apagando = false;
  const launch = jest.fn().mockImplementation(async () => { throw conflicto409(); });
  const espera = jest.fn().mockImplementation(async () => { apagando = true; }); // llega SIGTERM mientras espera
  await expect(lanzarBot({ launch, alConectar: jest.fn(), logger: logger(), esperar: espera, estaApagando: () => apagando })).resolves.toBeUndefined();
  expect(launch).toHaveBeenCalledTimes(1);
});
