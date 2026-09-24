// Ítem 3.4: el nombre del paciente (cargado desde el dashboard, texto libre)
// iba sin escapar en la notificación de "Llegó tu paciente" al profesional,
// con parse_mode: 'Markdown'.

jest.mock('../src/lib/supabase', () => ({ isAvailable: jest.fn(() => true) }));
jest.mock('../src/lib/tenant-db', () => ({
  forTenant: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({ data: [{ telegram_user_id: '9999', nombre: 'Diego' }] }),
      })),
    })),
  })),
}));

const mockSendMessage = jest.fn().mockResolvedValue(true);
jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: (...args) => mockSendMessage(...args) } } }));

const { notificarLlegadaPaciente } = require('../src/services/profesional.service');

beforeEach(() => jest.clearAllMocks());

test('escapa "_" y "*" del nombre del paciente y del servicio en la notificación', async () => {
  await notificarLlegadaPaciente('tenant-1', 'Diego', 'Juan_Perez', '10:00', 'Control *urgente*');

  expect(mockSendMessage).toHaveBeenCalledTimes(1);
  const [, mensaje] = mockSendMessage.mock.calls[0];
  expect(mensaje).toContain('Juan\\_Perez');
  expect(mensaje).toContain('Control \\*urgente\\*');
  expect(mensaje).not.toContain('Juan_Perez');
  expect(mensaje).not.toContain('Control *urgente*');
});
