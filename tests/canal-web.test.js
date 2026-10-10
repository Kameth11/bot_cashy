// Canal web (src/lib/canal-web.js): el chat del dashboard corre el MISMO
// pipeline de Telegraf que Telegram. Se registran handlers de prueba en el bot
// real (más el voice.js real) y se verifica que lo que el bot "responde"
// queda en el historial web en vez de ir a la API de Telegram.

jest.mock('../src/lib/logger', () => ({
  audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

jest.mock('../src/services/events.service', () => ({
  emitChatUpdated: jest.fn(),
}));

jest.mock('../src/services/gemini.service', () => ({
  transcribirAudio: jest.fn().mockResolvedValue('consulta Juan 15000 efectivo'),
}));

jest.mock('../src/handlers/text', () => ({
  procesarTextoConNlp: jest.fn(async (ctx, texto) => ctx.reply(`NLP: ${texto}`)),
}));

jest.mock('../src/auth', () => ({
  esAdminOriginal: jest.fn().mockReturnValue(false),
  obtenerClientePorUserId: jest.fn().mockReturnValue({ userId: '5555', isOwner: true }),
}));

jest.mock('../src/auth/bot-permisos', () => ({
  requierePermisoBot: jest.fn().mockReturnValue(true),
}));

jest.mock('../src/handlers/guards', () => ({
  tieneProcesoPendiente: jest.fn().mockReturnValue(false),
}));

const { bot, Markup } = require('../src/lib/telegraf');
const eventsService = require('../src/services/events.service');
const geminiService = require('../src/services/gemini.service');
const { procesarTextoConNlp } = require('../src/handlers/text');
const canalWeb = require('../src/lib/canal-web');

const USER = 5555;
const OTRO = 7777;
let apiReal;

beforeAll(() => {
  bot.command('balance', ctx => ctx.reply('*Balance* del mes', { parse_mode: 'Markdown' }));
  bot.command('avisar', async ctx => {
    await ctx.telegram.sendMessage(OTRO, 'aviso para otro chat');
    await ctx.reply('avisado');
  });
  bot.hears(/^gasto/, ctx => ctx.reply('¿Confirmás?', Markup.inlineKeyboard([
    [Markup.button.callback('✅ Sí', 'web_si'), Markup.button.callback('❌ No', 'web_no')],
    [Markup.button.url('Ver Sheet', 'https://example.com')],
  ])));
  bot.action('web_si', async ctx => {
    await ctx.answerCbQuery('Guardado');
    await ctx.editMessageText('✅ Guardado');
  });
  bot.hears('explota', () => { throw new Error('boom'); });
  require('../src/handlers/voice');
});

beforeEach(() => {
  canalWeb._resetParaTests();
  jest.clearAllMocks();
  apiReal = jest.spyOn(require('telegraf').Telegram.prototype, 'callApi')
    .mockImplementation(async (method) => {
      throw new Error(`No debería llamar a la API de Telegram (${method})`);
    });
});

afterEach(() => apiReal.mockRestore());

describe('canal web', () => {
  test('un comando corre el handler del bot y la respuesta queda en el historial', async () => {
    const r = await canalWeb.enviarTexto(USER, '/balance');
    expect(r.mensajes).toEqual([
      expect.objectContaining({ de: 'yo', texto: '/balance' }),
      expect.objectContaining({ de: 'bot', texto: '*Balance* del mes', formato: 'Markdown', botones: [] }),
    ]);
    expect(eventsService.emitChatUpdated).toHaveBeenCalledWith(String(USER), expect.any(Number));
  });

  test('los botones inline llegan a la web y apretarlos corre la acción del bot', async () => {
    const r = await canalWeb.enviarTexto(USER, 'gasto insumos 500');
    const pregunta = r.mensajes[1];
    expect(pregunta.botones).toEqual([
      [{ texto: '✅ Sí', data: 'web_si' }, { texto: '❌ No', data: 'web_no' }],
      [{ texto: 'Ver Sheet', url: 'https://example.com' }],
    ]);

    const r2 = await canalWeb.apretarBoton(USER, pregunta.id, 'web_si');
    expect(r2.avisos).toEqual(['Guardado']);
    const editado = r2.mensajes.find(m => m.id === pregunta.id);
    expect(editado).toEqual(expect.objectContaining({ texto: '✅ Guardado', botones: [], editado: true }));
  });

  test('no se puede mandar un callback que no esté en un botón del bot', async () => {
    const r = await canalWeb.enviarTexto(USER, 'gasto insumos 500');
    const pregunta = r.mensajes[1];
    const r2 = await canalWeb.apretarBoton(USER, pregunta.id, 'cualquier_cosa');
    expect(r2.invalido).toBe(true);
    // El mensaje propio del usuario tampoco tiene botones que apretar.
    const r3 = await canalWeb.apretarBoton(USER, r.mensajes[0].id, 'web_si');
    expect(r3.invalido).toBe(true);
  });

  test('lo que el bot manda a OTRO chat sigue saliendo por Telegram', async () => {
    apiReal.mockImplementation(async () => ({ message_id: 1 }));
    const r = await canalWeb.enviarTexto(USER, '/avisar');
    expect(apiReal).toHaveBeenCalledWith('sendMessage', expect.objectContaining({ chat_id: OTRO, text: 'aviso para otro chat' }), undefined);
    expect(r.mensajes.map(m => m.texto)).toEqual(['/avisar', 'avisado']);
  });

  test('una nota de voz pasa por voice.js real: transcribe con el MIME del navegador y sigue al NLP', async () => {
    const buffer = Buffer.from('audio-falso');
    const r = await canalWeb.enviarAudio(USER, { buffer, mimeType: 'audio/webm', duracion: 4 });
    expect(geminiService.transcribirAudio).toHaveBeenCalledWith(buffer, 'audio/webm');
    expect(procesarTextoConNlp).toHaveBeenCalledWith(expect.anything(), 'consulta Juan 15000 efectivo');
    expect(r.mensajes.map(m => m.texto)).toEqual([
      '🎤 Nota de voz',
      '🎤 Transcribiendo audio...',
      '🎤 "consulta Juan 15000 efectivo"',
      'NLP: consulta Juan 15000 efectivo',
    ]);
  });

  test('un error en un handler le avisa al usuario por el chat, como en Telegram', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await canalWeb.enviarTexto(USER, 'explota');
    expect(r.mensajes[r.mensajes.length - 1].texto).toMatch(/error inesperado/);
    console.error.mockRestore();
  });

  test('el historial se recorta a MAX_MENSAJES', async () => {
    for (let i = 0; i < canalWeb.MAX_MENSAJES; i++) {
      await canalWeb.enviarTexto(USER, '/balance');
    }
    const { mensajes } = canalWeb.obtenerConversacion(USER);
    expect(mensajes).toHaveLength(canalWeb.MAX_MENSAJES);
    expect(mensajes[mensajes.length - 1].texto).toBe('*Balance* del mes');
  });

  test('cada usuario tiene su propia conversación', async () => {
    await canalWeb.enviarTexto(USER, '/balance');
    expect(canalWeb.obtenerConversacion(9999).mensajes).toEqual([]);
  });
});
