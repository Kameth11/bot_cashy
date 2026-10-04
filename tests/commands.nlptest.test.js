const handlers = {};

jest.mock('../src/lib/telegraf', () => ({
  bot: { command: (name, handler) => { handlers[name] = handler; } },
}));

jest.mock('../src/auth', () => ({
  esAdminOriginal: jest.fn(() => true),
}));

jest.mock('../src/services/quick_nlp.service', () => ({ ...jest.requireActual('../src/services/quick_nlp.service'), quickParse: jest.fn() }));
jest.mock('../src/services/personal.service', () => ({ leerPreferencias: jest.fn(async () => ({})) }));
jest.mock('../src/services/casa.service', () => ({ listarMisCasas: jest.fn(() => []) }));
jest.mock('../src/services/gemini.service', () => ({
  canAttemptRemoteNlp: jest.fn(() => true),
  parseMessage: jest.fn(),
}));

const { esAdminOriginal } = require('../src/auth');
const quickNlp = require('../src/services/quick_nlp.service');
const gemini = require('../src/services/gemini.service');
const { compararNlp } = require('../src/handlers/commands/nlptest');

function makeCtx(text) {
  return { from: { id: 1 }, message: { text }, reply: jest.fn().mockResolvedValue(true) };
}

const ultimo = (ctx) => ctx.reply.mock.calls[ctx.reply.mock.calls.length - 1][0];

beforeEach(() => {
  esAdminOriginal.mockReturnValue(true);
  gemini.canAttemptRemoteNlp.mockReturnValue(true);
});

describe('compararNlp', () => {
  test('mismo intent y entidades → sin diferencias (null y ausente son lo mismo)', () => {
    const a = { intent: 'registrar_movimiento', entities: { tipo: 'gasto', monto: 500, nota: null } };
    const b = { intent: 'registrar_movimiento', entities: { tipo: 'Gasto', monto: '500' } };
    expect(compararNlp(a, b)).toEqual([]);
  });

  test('detecta diferencia de tipo y de intent', () => {
    expect(compararNlp(
      { intent: 'registrar_movimiento', entities: { tipo: 'ingreso' } },
      { intent: 'registrar_movimiento', entities: { tipo: 'gasto' } },
    )).toEqual(['tipo (ingreso vs gasto)']);
    expect(compararNlp({ intent: 'ver_hoy' }, { intent: 'ver_egresos' })).toEqual(['intent (ver_hoy vs ver_egresos)']);
  });
});

describe('/nlptest', () => {
  test('no admin → rechazado y no consulta nada', async () => {
    esAdminOriginal.mockReturnValue(false);
    const ctx = makeCtx('/nlptest hola');
    await handlers.nlptest(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('administrador'));
    expect(gemini.parseMessage).not.toHaveBeenCalled();
  });

  test('sin frase muestra el uso', async () => {
    const ctx = makeCtx('/nlptest');
    await handlers.nlptest(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain('Uso');
    expect(quickNlp.quickParse).not.toHaveBeenCalled();
  });

  test('consulta Gemini AUNQUE las reglas resuelvan y marca las diferencias', async () => {
    quickNlp.quickParse.mockReturnValue({ intent: 'registrar_movimiento', entities: { tipo: 'ingreso', monto: 5000 } });
    gemini.parseMessage.mockResolvedValue({ intent: 'registrar_movimiento', entities: { tipo: 'gasto', monto: 5000 } });
    const ctx = makeCtx('/nlptest salió de mi cuenta 5000');
    await handlers.nlptest(ctx);
    expect(gemini.parseMessage).toHaveBeenCalledWith(1, 'salió de mi cuenta 5000');
    const msg = ultimo(ctx);
    expect(msg).toContain('Reglas');
    expect(msg).toContain('Gemini');
    expect(msg).toContain('Difieren');
    expect(msg).toContain('tipo (ingreso vs gasto)');
  });

  test('coinciden → lo dice', async () => {
    const r = { intent: 'ver_hoy', entities: {} };
    quickNlp.quickParse.mockReturnValue(r);
    gemini.parseMessage.mockResolvedValue(r);
    const ctx = makeCtx('/nlptest ver hoy');
    await handlers.nlptest(ctx);
    expect(ultimo(ctx)).toContain('Coinciden');
  });

  test('reglas no matchean pero Gemini sí', async () => {
    quickNlp.quickParse.mockReturnValue(null);
    gemini.parseMessage.mockResolvedValue({ intent: 'ver_hoy', entities: {} });
    const ctx = makeCtx('/nlptest algo raro');
    await handlers.nlptest(ctx);
    expect(ultimo(ctx)).toContain('no matchearon');
    expect(ultimo(ctx)).toContain('Solo respondió Gemini');
  });

  test('Gemini en cooldown → no lo llama y lo explica', async () => {
    quickNlp.quickParse.mockReturnValue({ intent: 'ver_hoy', entities: {} });
    gemini.canAttemptRemoteNlp.mockReturnValue(false);
    const ctx = makeCtx('/nlptest ver hoy');
    await handlers.nlptest(ctx);
    expect(gemini.parseMessage).not.toHaveBeenCalled();
    expect(ultimo(ctx)).toContain('cooldown');
  });

  test('Gemini tira error → se informa y el comando no rompe', async () => {
    quickNlp.quickParse.mockReturnValue(null);
    gemini.parseMessage.mockRejectedValue(new Error('boom'));
    const ctx = makeCtx('/nlptest x');
    await handlers.nlptest(ctx);
    expect(ultimo(ctx)).toContain('boom');
  });
});


describe('diagnóstico de ámbito', () => {
  const personalService = require('../src/services/personal.service');
  const casaService = require('../src/services/casa.service');
  const { diagnosticoAmbito } = require('../src/handlers/commands/nlptest');

  beforeEach(() => {
    personalService.leerPreferencias.mockResolvedValue({});
    casaService.listarMisCasas.mockReturnValue([]);
  });

  test('muestra el ámbito, la razón y la categoría que resolvería el bot', async () => {
    const d = await diagnosticoAmbito(1, 'pague 15000 pesos para el cine');
    expect(d).toContain('`personal`');
    expect(d).toContain('marcador_personal');
    expect(d).toContain('entretenimiento');
  });

  test('una empresa de servicios se marca como ambigua', async () => {
    const d = await diagnosticoAmbito(1, 'pagué naturgy 25000');
    expect(d).toContain('`consultorio`');
    expect(d).toContain('ambiguo');
    expect(d).toContain('naturgy');
  });

  test('usa TUS preferencias y TUS casas', async () => {
    personalService.leerPreferencias.mockResolvedValue({ naturgy: 'personal' });
    expect((await diagnosticoAmbito(1, 'pagué naturgy 25000'))).toContain('`personal` (`preferencia`)');

    casaService.listarMisCasas.mockReturnValue([{ casaId: 'c1', nombre: 'Casa', activa: true }]);
    const d = await diagnosticoAmbito(1, 'super 45000 casa');
    expect(d).toContain('casa (Casa)');
    expect(d).toContain('casas: 1');
  });

  test('los guiones bajos de la razón van en código: si no, Telegram rechaza el Markdown y llega sin formato', async () => {
    const d = await diagnosticoAmbito(1, 'pague 15000 pesos para el cine');
    expect(d).toContain('(`marcador_personal`)');
    // Ningún "_" suelto fuera de un bloque de código.
    expect(d.replace(/`[^`]*`/g, '')).not.toMatch(/_/);
  });

  test('si algo falla, lo informa sin romper el comando', async () => {
    personalService.leerPreferencias.mockRejectedValue(new Error('sheet caído'));
    expect(await diagnosticoAmbito(1, 'cine 100')).toContain('no se pudo calcular');
  });

  test('el mensaje completo incluye el diagnóstico al final', async () => {
    quickNlp.quickParse.mockReturnValue({ intent: 'ver_hoy', entities: {} });
    gemini.parseMessage.mockResolvedValue({ intent: 'ver_hoy', entities: {} });
    const c = makeCtx('/nlptest ver hoy');
    await handlers.nlptest(c);
    expect(ultimo(c)).toContain('Ámbito');
  });
});
