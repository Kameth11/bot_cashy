// Persistencia del historial del chat web: se restaura una vez por proceso, se
// guarda con una pequeña espera (juntando ráfagas), se vacía al apagar y un
// guardado fallido se reintenta en el próximo cambio.

jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/services/events.service', () => ({ emitChatUpdated: jest.fn() }));
jest.mock('../src/services/chat-historial.service', () => ({
  cargar: jest.fn(),
  guardar: jest.fn(),
}));
jest.mock('../src/auth', () => ({
  esAdminOriginal: jest.fn().mockReturnValue(false),
  obtenerClientePorUserId: jest.fn().mockReturnValue({ userId: '5555', isOwner: true }),
}));

const { bot } = require('../src/lib/telegraf');
const historial = require('../src/services/chat-historial.service');
const canalWeb = require('../src/lib/canal-web');

const USER = 5555;
const AHORA = Date.now();
const DIA = 24 * 60 * 60 * 1000;

beforeAll(() => {
  bot.command('hola', ctx => ctx.reply('¡Hola!'));
});

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  canalWeb._resetParaTests();
  jest.clearAllMocks();
  historial.cargar.mockResolvedValue(null);
  historial.guardar.mockResolvedValue(true);
});

afterEach(() => jest.useRealTimers());

const guardado = (n = 0) => ({ ...historial.guardar.mock.calls[n][1] });

describe('restaurar', () => {
  test('recupera los mensajes recientes sin botones, descarta los viejos y sigue la numeración', async () => {
    historial.cargar.mockResolvedValue({
      ultimoId: 9,
      rev: 40,
      mensajes: [
        { id: 1, de: 'yo', texto: 'muy viejo', ts: AHORA - 31 * DIA, botones: [] },
        { id: 8, de: 'yo', texto: 'gasto insumos 500', ts: AHORA - 2 * DIA, botones: [] },
        { id: 9, de: 'bot', texto: '¿Es correcto?', ts: AHORA - 2 * DIA, botones: [[{ texto: 'Guardar', data: 'nlp_save' }]] },
        { id: 'roto', de: 'bot', texto: 'sin id válido', ts: AHORA },
      ],
    });

    const r = await canalWeb.obtenerConversacion(USER);
    expect(r.mensajes.map(m => m.id)).toEqual([8, 9]);
    expect(r.mensajes[1].botones).toEqual([]);
    expect(r.rev).toBe(40);
    expect(r.epoca).toBe(canalWeb.EPOCA);

    const nuevo = await canalWeb.enviarTexto(USER, '/hola');
    expect(nuevo.mensajes.map(m => m.id)).toEqual([8, 9, 10, 11]); // sigue donde quedó
    expect(nuevo.rev).toBeGreaterThan(40);
  });

  test('se carga una sola vez por persona, aunque lleguen pedidos juntos', async () => {
    await Promise.all([canalWeb.obtenerConversacion(USER), canalWeb.obtenerConversacion(USER), canalWeb.enviarTexto(USER, '/hola')]);
    expect(historial.cargar).toHaveBeenCalledTimes(1);
  });

  test('si no hay nada guardado (o la lectura falla) arranca vacío', async () => {
    const r = await canalWeb.obtenerConversacion(USER);
    expect(r.mensajes).toEqual([]);
    historial.cargar.mockRejectedValueOnce(new Error('caído'));
    canalWeb._resetParaTests();
    expect((await canalWeb.obtenerConversacion(USER)).mensajes).toEqual([]);
  });
});

describe('guardar', () => {
  test('espera y junta una ráfaga de cambios en un solo guardado', async () => {
    await canalWeb.enviarTexto(USER, '/hola');
    await canalWeb.enviarTexto(USER, '/hola');
    expect(historial.guardar).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1600);
    expect(historial.guardar).toHaveBeenCalledTimes(1);
    const g = guardado();
    expect(g.mensajes.map(m => m.texto)).toEqual(['/hola', '¡Hola!', '/hola', '¡Hola!']);
    expect(g.ultimoId).toBe(4);
    expect(g.rev).toBe(4);
  });

  test('no guarda los botones (ya no sirven al restaurar)', async () => {
    bot.hears('con-botones', ctx => ctx.reply('¿Sí?', { reply_markup: { inline_keyboard: [[{ text: 'Sí', callback_data: 'si' }]] } }));
    const r = await canalWeb.enviarTexto(USER, 'con-botones');
    expect(r.mensajes[1].botones).toHaveLength(1); // en memoria sí están
    await jest.advanceTimersByTimeAsync(1600);
    expect(guardado().mensajes.every(m => m.botones.length === 0)).toBe(true);
  });

  test('vaciarGuardados guarda ya, sin esperar el temporizador (apagado ordenado)', async () => {
    await canalWeb.enviarTexto(USER, '/hola');
    expect(historial.guardar).not.toHaveBeenCalled();
    await canalWeb.vaciarGuardados();
    expect(historial.guardar).toHaveBeenCalledTimes(1);
    expect(guardado().mensajes).toHaveLength(2);

    // y no vuelve a guardar lo que ya está guardado
    await jest.advanceTimersByTimeAsync(5000);
    expect(historial.guardar).toHaveBeenCalledTimes(1);
  });

  test('si el guardado falla, se reintenta con lo siguiente que cambie', async () => {
    historial.guardar.mockResolvedValueOnce(false);
    await canalWeb.enviarTexto(USER, '/hola');
    await jest.advanceTimersByTimeAsync(1600);
    expect(historial.guardar).toHaveBeenCalledTimes(1);

    await canalWeb.enviarTexto(USER, '/hola');
    await jest.advanceTimersByTimeAsync(1600);
    expect(historial.guardar).toHaveBeenCalledTimes(2);
    expect(guardado(1).mensajes).toHaveLength(4); // incluye lo que no se había podido guardar
  });

  test('nunca hay dos guardados de la misma persona a la vez', async () => {
    let enCurso = 0; let maximo = 0;
    historial.guardar.mockImplementation(async () => {
      enCurso++; maximo = Math.max(maximo, enCurso);
      await new Promise(r => setTimeout(r, 3000));
      enCurso--;
      return true;
    });
    await canalWeb.enviarTexto(USER, '/hola');
    await jest.advanceTimersByTimeAsync(1600);   // empieza el 1º guardado (tarda 3 s)
    await canalWeb.enviarTexto(USER, '/hola');
    await jest.advanceTimersByTimeAsync(1600);   // el 2º tiene que esperar al 1º
    await jest.advanceTimersByTimeAsync(10000);
    expect(maximo).toBe(1);
    expect(historial.guardar).toHaveBeenCalledTimes(2);
  });
});
