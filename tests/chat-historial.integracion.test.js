// Integración: canal web + servicio de historial REAL + Supabase falso. Simula un
// deploy (módulos nuevos, base compartida) y verifica que la conversación sigue
// ahí, con otra "época" y sin botones, y que la persona de al lado no la ve.

jest.mock('../src/lib/supabase', () => ({ getSupabase: jest.fn(), isAvailable: jest.fn(() => true) }));
jest.mock('../src/lib/logger', () => ({ audit: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/services/events.service', () => ({ emitChatUpdated: jest.fn() }));
jest.mock('../src/services/tenant.service', () => ({ resolveTenantId: jest.fn(async () => 'tenant-1') }));
jest.mock('../src/services/db.service', () => ({ ensureProfile: jest.fn(async () => true) }));
jest.mock('../src/auth', () => ({
  esAdminOriginal: jest.fn().mockReturnValue(false),
  obtenerClientePorUserId: jest.fn().mockReturnValue({ userId: '5555', isOwner: true }),
}));

const { crearSupabaseFalso } = require('./helpers/fake-supabase');

// Carga canal-web "desde cero", como un proceso nuevo tras un deploy.
function arrancarProceso() {
  let canal;
  jest.isolateModules(() => {
    const { bot } = require('../src/lib/telegraf');
    bot.command('hola', ctx => ctx.reply('¡Hola!'));
    bot.hears('confirmar', ctx => ctx.reply('¿Confirmás?', { reply_markup: { inline_keyboard: [[{ text: 'Sí', callback_data: 'si' }]] } }));
    canal = require('../src/lib/canal-web');
  });
  return canal;
}

let fake;
beforeEach(() => {
  fake = crearSupabaseFalso();
  require('../src/lib/supabase').getSupabase.mockReturnValue(fake);
});

test('la conversación sobrevive a un deploy', async () => {
  const antes = arrancarProceso();
  await antes.enviarTexto(5555, '/hola');
  const conBoton = await antes.enviarTexto(5555, 'confirmar');
  expect(conBoton.mensajes[3].botones).toHaveLength(1);
  await antes.vaciarGuardados(); // lo que hace el apagado ordenado (SIGTERM)

  const despues = arrancarProceso(); // proceso nuevo, memoria vacía
  expect(despues.EPOCA).not.toBe(antes.EPOCA);
  const r = await despues.obtenerConversacion(5555);
  expect(r.mensajes.map(m => m.texto)).toEqual(['/hola', '¡Hola!', 'confirmar', '¿Confirmás?']);
  expect(r.mensajes[3].botones).toEqual([]);        // esa confirmación ya no existe
  expect(r.epoca).toBe(despues.EPOCA);
  expect(r.rev).toBe(conBoton.rev);                 // la revisión no vuelve a cero

  const nuevo = await despues.enviarTexto(5555, '/hola');
  expect(nuevo.mensajes.map(m => m.id)).toEqual([1, 2, 3, 4, 5, 6]); // la numeración sigue
});

test('otra persona no ve esa conversación', async () => {
  const antes = arrancarProceso();
  await antes.enviarTexto(5555, '/hola');
  await antes.vaciarGuardados();

  const despues = arrancarProceso();
  expect((await despues.obtenerConversacion(6666)).mensajes).toEqual([]);
});

test('sin Supabase el chat anda igual, solo que no recuerda', async () => {
  require('../src/lib/supabase').getSupabase.mockReturnValue(null);
  const antes = arrancarProceso();
  const r = await antes.enviarTexto(5555, '/hola');
  expect(r.mensajes).toHaveLength(2);
  await antes.vaciarGuardados();
  expect((await arrancarProceso().obtenerConversacion(5555)).mensajes).toEqual([]);
});
