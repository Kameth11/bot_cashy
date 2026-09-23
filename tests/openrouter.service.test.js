process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.OPENROUTER_MODEL = 'test/model';

const { parseMessage, canAttemptFullIA } = require('../src/services/openrouter.service');

function mockFetchOnce(status, body) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe('openrouter.service', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test('canAttemptFullIA es true con OPENROUTER_API_KEY configurada', () => {
    expect(canAttemptFullIA()).toBe(true);
  });

  test('parseMessage normaliza una respuesta válida de registrar_movimiento', async () => {
    mockFetchOnce(200, {
      choices: [{
        message: {
          content: JSON.stringify({
            intent: 'registrar_movimiento',
            entities: { tipo: 'ingreso', descripcion: 'Juan', monto: 15000, moneda: 'Pesos', metodo_pago: 'efectivo' },
          }),
        },
      }],
    });

    const result = await parseMessage(123, 'consulta Juan $15000 efectivo');

    expect(result).not.toBeNull();
    expect(result.intent).toBe('registrar_movimiento');
    expect(result.entities.descripcion).toBe('Juan');
    expect(result.entities.monto).toBe(15000);
    expect(result.entities.estado).toBe('Cobrado');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-openrouter-key' }),
      })
    );
  });

  test('parseMessage devuelve null si OpenRouter responde con error HTTP', async () => {
    mockFetchOnce(500, { error: 'boom' });
    const result = await parseMessage(123, 'consulta Juan $15000 efectivo');
    expect(result).toBeNull();
  });

  test('parseMessage devuelve null si el contenido no es JSON válido', async () => {
    mockFetchOnce(200, { choices: [{ message: { content: 'no es json' } }] });
    const result = await parseMessage(123, 'hola');
    expect(result).toBeNull();
  });

  test('parseMessage devuelve null si falla la red', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const result = await parseMessage(123, 'hola');
    expect(result).toBeNull();
  });
});
