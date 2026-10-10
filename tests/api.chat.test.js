// Rutas /api/chat/*: validan la forma del pedido y le pasan al canal web el
// userId de la sesión (nunca uno que venga del body).

jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return { '1001': { email: 'a@test.com', sheetId: 's1', usuarios: [] } };
  },
  cargarClientes: jest.fn(), guardarClientes: jest.fn(), getCliente: jest.fn(), eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

jest.mock('../src/lib/canal-web', () => ({
  obtenerConversacion: jest.fn(() => ({ rev: 3, mensajes: [], avisos: [] })),
  enviarTexto: jest.fn(async () => ({ rev: 4, mensajes: [{ id: 1 }], avisos: [] })),
  enviarAudio: jest.fn(async () => ({ rev: 5, mensajes: [], avisos: [] })),
  apretarBoton: jest.fn(async () => ({ rev: 6, mensajes: [], avisos: [] })),
}));

const jwt = require('jsonwebtoken');
const { app, JWT_SECRET } = require('../src/api/index.js');
const canalWeb = require('../src/lib/canal-web');

const token = jwt.sign({ userId: '1001', type: 'dashboard' }, JWT_SECRET, { expiresIn: '1d' });
const auth = { Authorization: `Bearer ${token}` };

let server;
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => jest.clearAllMocks());

function postJson(ruta, body, headers = auth) {
  return fetch(`${baseUrl}${ruta}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/chat', () => {
  test('sin sesión devuelve 401', async () => {
    expect((await fetch(`${baseUrl}/api/chat`)).status).toBe(401);
    expect((await postJson('/api/chat/mensaje', { texto: 'hola' }, {})).status).toBe(401);
  });

  test('GET devuelve la conversación del usuario de la sesión', async () => {
    const res = await fetch(`${baseUrl}/api/chat`, { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rev: 3, mensajes: [], avisos: [] });
    expect(canalWeb.obtenerConversacion).toHaveBeenCalledWith('1001');
  });

  test('mensaje: usa el userId de la sesión aunque el body traiga otro', async () => {
    const res = await postJson('/api/chat/mensaje', { texto: '  consulta Juan 1000  ', userId: '9999' });
    expect(res.status).toBe(200);
    expect(canalWeb.enviarTexto).toHaveBeenCalledWith('1001', 'consulta Juan 1000');
  });

  test('mensaje vacío o demasiado largo: 400', async () => {
    expect((await postJson('/api/chat/mensaje', { texto: '   ' })).status).toBe(400);
    expect((await postJson('/api/chat/mensaje', { texto: 'x'.repeat(4001) })).status).toBe(400);
    expect(canalWeb.enviarTexto).not.toHaveBeenCalled();
  });

  test('audio: pasa el buffer, el MIME sin parámetros y la duración', async () => {
    const res = await fetch(`${baseUrl}/api/chat/audio?duracion=7`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'audio/webm;codecs=opus' },
      body: Buffer.from('audio'),
    });
    expect(res.status).toBe(200);
    expect(canalWeb.enviarAudio).toHaveBeenCalledWith('1001', {
      buffer: Buffer.from('audio'), mimeType: 'audio/webm', duracion: 7,
    });
  });

  test('audio con otro tipo de archivo: 400', async () => {
    const res = await fetch(`${baseUrl}/api/chat/audio`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'image/png' },
      body: Buffer.from('x'),
    });
    expect(res.status).toBe(400);
    expect(canalWeb.enviarAudio).not.toHaveBeenCalled();
  });

  test('botón: valida forma y responde 409 si el canal lo rechaza', async () => {
    expect((await postJson('/api/chat/boton', { mensajeId: 'a', data: 'x' })).status).toBe(400);
    expect((await postJson('/api/chat/boton', { mensajeId: 2, data: '' })).status).toBe(400);

    expect((await postJson('/api/chat/boton', { mensajeId: 2, data: 'nlp_save' })).status).toBe(200);
    expect(canalWeb.apretarBoton).toHaveBeenCalledWith('1001', 2, 'nlp_save');

    canalWeb.apretarBoton.mockResolvedValueOnce({ rev: 7, mensajes: [], avisos: ['x'], invalido: true });
    expect((await postJson('/api/chat/boton', { mensajeId: 2, data: 'otro' })).status).toBe(409);
  });
});
