// El aviso "Llegó tu paciente" se perdía en silencio cuando el nombre del
// profesional en la agenda no coincidía letra por letra con el registrado en
// /profesional (tildes, "Dra.", nombre completo vs. solo el nombre).

let mockProfesionales = [];
jest.mock('../src/lib/supabase', () => ({ isAvailable: jest.fn(() => true) }));
jest.mock('../src/lib/tenant-db', () => ({
  forTenant: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ data: mockProfesionales })),
      })),
    })),
  })),
}));

const mockSendMessage = jest.fn().mockResolvedValue(true);
jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: (...args) => mockSendMessage(...args) } } }));

const {
  buscarProfesionalPorNombre,
  notificarLlegadaPaciente,
  normalizarNombreProfesional,
} = require('../src/services/profesional.service');

beforeEach(() => {
  jest.clearAllMocks();
  mockProfesionales = [
    { telegram_user_id: '1', nombre: 'Dra. María López' },
    { telegram_user_id: '2', nombre: 'Diego Pérez' },
  ];
});

test('normaliza tildes, mayúsculas, títulos y puntuación', () => {
  expect(normalizarNombreProfesional('Dra. María López')).toBe('maria lopez');
  expect(normalizarNombreProfesional('  OD.  Diego ')).toBe('diego');
});

test.each([
  ['maria', '1'],
  ['Maria Lopez', '1'],
  ['Dra Maria', '1'],
  ['diego', '2'],
  ['Dr. Diego Perez', '2'],
])('"%s" matchea al profesional %s', async (nombre, id) => {
  const p = await buscarProfesionalPorNombre('t1', nombre);
  expect(p?.telegram_user_id).toBe(id);
});

test('mismo primer nombre con apellido distinto resuelve si es único', async () => {
  const p = await buscarProfesionalPorNombre('t1', 'Diego Gomez');
  expect(p?.telegram_user_id).toBe('2');
});

test('no adivina si el primer nombre es ambiguo', async () => {
  mockProfesionales.push({ telegram_user_id: '3', nombre: 'Diego Ruiz' });
  expect(await buscarProfesionalPorNombre('t1', 'Diego Gomez')).toBeNull();
});

test('devuelve el motivo cuando no se puede avisar', async () => {
  expect(await notificarLlegadaPaciente('t1', '', 'Juan')).toEqual({ ok: false, error: 'sin_profesional' });
  expect(await notificarLlegadaPaciente(null, 'Diego', 'Juan')).toEqual({ ok: false, error: 'tenant_no_resuelto' });
  expect(await notificarLlegadaPaciente('t1', 'Laura', 'Juan')).toEqual({ ok: false, error: 'profesional_no_encontrado' });

  mockSendMessage.mockRejectedValueOnce(new Error('403: bot was blocked by the user'));
  expect(await notificarLlegadaPaciente('t1', 'Diego', 'Juan')).toEqual({ ok: false, error: 'envio_fallido', profesional: 'Diego Pérez' });
  expect(mockSendMessage).toHaveBeenCalledTimes(1);
});

test('avisa al telegram del profesional encontrado', async () => {
  const r = await notificarLlegadaPaciente('t1', 'maria', 'Juan', '10:00', 'Limpieza');
  expect(r).toEqual({ ok: true, profesional: 'Dra. María López' });
  expect(mockSendMessage.mock.calls[0][0]).toBe(1);
});
