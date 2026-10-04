// Fase 4 de PLAN_COMPROBANTES.md: subir un comprobante desde el dashboard.
// /leer lee con IA y guarda lo leído del lado del servidor; POST
// /api/comprobantes guarda con lo que el usuario corrigió, sin aceptar del
// cliente el hash, el archivo ni los datos fiscales.

jest.mock('../src/lib/telegraf', () => ({ bot: { telegram: { sendMessage: jest.fn(), sendDocument: jest.fn() } } }));

jest.mock('../src/config', () => ({
  AUTHORIZED_USER_ID: 1111,
  JWT_SECRET: 'test-secret-comprobantes-subida',
  ALLOWED_EMAILS: [],
  CODIGO_EXPIRACION_HORAS: 24,
  USE_SUPABASE: false,
  CLIENTES_FILE: '/tmp/clientes_comprobantes_subida_test.json',
  SPREADSHEET_ID: 'sheet-test',
  DASHBOARD_API_PORT: 0,
  MAX_PHOTO_SIZE_BYTES: 1024 * 1024,
  SESSION_REFRESH_THRESHOLD_SEC: 30 * 24 * 60 * 60,
}));

jest.mock('../src/services/cliente.service', () => ({
  get clientes() {
    return {
      '2222': {
        email: 'owner@test.com', sheetId: 'sheet-owner', usuarios: [3333, 4444],
        permisos: { '3333': ['ver_movimientos', 'cargar_movimientos'], '4444': ['ver_movimientos'] },
      },
    };
  },
  cargarClientes: jest.fn().mockResolvedValue({}), guardarClientes: jest.fn(), getCliente: jest.fn(),
  eliminarCliente: jest.fn(), getPermisos: jest.fn(), setPermisos: jest.fn(),
}));

const FACTURA = {
  tipoDocumento: 'ticket', letra: null, emisor: 'Coto', cuit: '30-54808315-6', numero: '0012-00345678',
  fechaEmision: '01/10/2026', fechaVencimiento: null, total: 20000, moneda: 'Pesos', metodoPago: 'tarjeta',
  pagado: true, rubro: 'supermercado', descripcion: 'Súper - Coto', categoria: 'otro_egreso', items: [{ descripcion: 'Leche' }],
};

jest.mock('../src/services/comprobante-vision.service', () => ({
  extraerFactura: jest.fn(async () => ({ factura: FACTURA })),
  extraerTransferencia: jest.fn(async () => ({ transferencia: { pagador: 'Juan Perez', monto: 30000, moneda: 'Pesos', numeroOperacion: '123', fecha: '01/10/2026' } })),
}));

jest.mock('../src/services/comprobante.service', () => ({
  ...jest.requireActual('../src/services/comprobante.service'),
  buscarDuplicado: jest.fn(async () => null),
}));

jest.mock('../src/services/comprobante-archivo.service', () => ({
  recordarArchivo: jest.fn(),
}));

jest.mock('../src/services/comprobante-registro.service', () => ({
  registrarComprobanteCompleto: jest.fn(async () => 'comp_x'),
  cobrarPendienteConTransferencia: jest.fn(async () => ({ mensaje: '✅ *Cobrado*', idMovimiento: 'mov_pend' })),
}));

jest.mock('../src/services/movimiento.service', () => ({
  ...jest.requireActual('../src/services/movimiento.service'),
  guardarMovimiento: jest.fn(async () => ({ idUnico: 'mov_nuevo' })),
}));

jest.mock('../src/services/personal.service', () => ({
  ...jest.requireActual('../src/services/personal.service'),
  leerPreferencias: jest.fn(async () => ({})),
  registrarMovimientoPersonal: jest.fn(async () => ({ movimiento: { idMov: 'pmov_1' }, viaje: null })),
}));

const mockFilaPendiente = { get: (k) => ({ ID_Unico: 'mov_pend', Descripcion: 'Endodoncia Juan Perez', Monto: 50000, Moneda: 'Pesos', Fecha: '20/09/2026', Estado: 'Pendiente' })[k] };
jest.mock('../src/services/command.service', () => ({
  ...jest.requireActual('../src/services/command.service'),
  buscarPendientesDePagador: jest.fn(async () => [mockFilaPendiente]),
}));

const { app, JWT_SECRET } = require('../src/api/index.js');
const state = require('../src/state');
const vision = require('../src/services/comprobante-vision.service');
const registro = require('../src/services/comprobante-registro.service');
const { guardarMovimiento } = require('../src/services/movimiento.service');
const personalService = require('../src/services/personal.service');
const aiQuota = require('../src/lib/ai-quota');

const crypto = require('crypto');
function token(userId) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ userId: String(userId), type: 'dashboard', iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

let server, baseUrl;
beforeAll(async () => {
  await new Promise(r => { server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
afterAll(async () => { await new Promise(r => server.close(r)); });
beforeEach(() => { jest.clearAllMocks(); aiQuota.reiniciar(); });

const leer = (userId, tipo = 'factura', body = Buffer.from('JPEG'), mime = 'image/jpeg') => fetch(`${baseUrl}/api/comprobantes/leer?tipo=${tipo}`, {
  method: 'POST', headers: { Authorization: `Bearer ${token(userId)}`, 'Content-Type': mime }, body,
});
const guardar = (userId, body) => fetch(`${baseUrl}/api/comprobantes`, {
  method: 'POST', headers: { Authorization: `Bearer ${token(userId)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('sin cargar_movimientos: 403 y no se gasta IA', async () => {
  expect((await leer(4444)).status).toBe(403);
  expect(vision.extraerFactura).not.toHaveBeenCalled();
});

test('formato no aceptado: 400', async () => {
  expect((await leer(2222, 'factura', 'hola', 'text/plain')).status).toBe(400);
});

test('dueño sube un ticket del súper: se sugiere Personal y no se expone hash/archivo', async () => {
  const res = await leer(2222);
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.sugerido).toMatchObject({ monto: 20000, ambito: 'personal', metodoPago: 'tarjeta' });
  expect(data.puedePersonal).toBe(true);
  expect(data.comprobante.hash).toBeUndefined();
  expect(data.comprobante.archivo).toBeUndefined();
  expect(state.pendingComprobantesDashboard.get(data.idComprobante)).toMatchObject({ userId: '2222', tipo: 'factura' });
});

test('invitado: siempre consultorio, sin opción Personal', async () => {
  const data = await (await leer(3333)).json();
  expect(data.sugerido.ambito).toBe('consultorio');
  expect(data.puedePersonal).toBe(false);
});

test('guardar en consultorio: egreso con el vínculo comp:<id> y el comprobante registrado', async () => {
  const { idComprobante } = await (await leer(3333)).json();
  const res = await guardar(3333, {
    idComprobante,
    movimiento: { descripcion: 'Súper corregido', monto: 21000, moneda: 'Pesos', metodoPago: 'tarjeta', estado: 'Pendiente', categoria: 'insumos', proveedor: 'Coto', fechaVencimiento: '2026-10-20', ambito: 'personal' },
  });
  expect(res.status).toBe(201);
  expect(guardarMovimiento).toHaveBeenCalledWith('3333', expect.objectContaining({
    descripcion: 'Súper corregido', monto: -21000, tipo: 'Egreso', estado: 'Pendiente', proveedorNombre: 'Coto',
    fechaVencimiento: '20/10/2026', referenciaId: `comp:${idComprobante}`, origenCarga: 'dashboard',
  }));
  expect(personalService.registrarMovimientoPersonal).not.toHaveBeenCalled(); // invitado: no puede Personal
  expect(registro.registrarComprobanteCompleto).toHaveBeenCalledWith('3333', expect.objectContaining({
    monto: 21000, comprobante: expect.objectContaining({ id: idComprobante, cuit: '30-54808315-6', hash: expect.any(String) }),
  }), { idMovimiento: 'mov_nuevo', respaldoTelegram: true });
  // Se usa una sola vez.
  expect((await guardar(3333, { idComprobante, movimiento: { descripcion: 'x', monto: 1 } })).status).toBe(410);
});

test('guardar en Personal (dueño)', async () => {
  const { idComprobante } = await (await leer(2222)).json();
  const res = await guardar(2222, { idComprobante, movimiento: { descripcion: 'Súper', monto: 20000, ambito: 'personal', categoria: 'supermercado' } });
  expect(res.status).toBe(201);
  expect(personalService.registrarMovimientoPersonal).toHaveBeenCalledWith('2222', expect.objectContaining({
    monto: 20000, categoria: 'supermercado', notas: `comp:${idComprobante}`, comercio: 'Coto', origenCarga: 'dashboard',
  }));
  expect(registro.registrarComprobanteCompleto).toHaveBeenCalledWith('2222', expect.anything(), { idMovimiento: 'pmov_1', respaldoTelegram: true });
});

test('otro usuario no puede guardar lo que leyó otro', async () => {
  const { idComprobante } = await (await leer(2222)).json();
  expect((await guardar(3333, { idComprobante, movimiento: { descripcion: 'x', monto: 1 } })).status).toBe(410);
});

test('transferencia: ofrece el pendiente y lo cobra', async () => {
  const data = await (await leer(3333, 'transferencia')).json();
  expect(data.pendientes).toEqual([expect.objectContaining({ idUnico: 'mov_pend', monto: 50000 })]);
  const res = await guardar(3333, { idComprobante: data.idComprobante, cobrarIdUnico: 'mov_pend', movimiento: { descripcion: 'Transferencia', monto: 30000 } });
  expect(res.status).toBe(201);
  expect(registro.cobrarPendienteConTransferencia).toHaveBeenCalledWith('3333', mockFilaPendiente, expect.objectContaining({ monto: 30000 }), { respaldoTelegram: true });
  expect((await res.json()).mensaje).toBe('✅ Cobrado');
  expect(guardarMovimiento).not.toHaveBeenCalled();
});

test('transferencia: no se puede cobrar un pendiente que no se ofreció', async () => {
  const data = await (await leer(3333, 'transferencia')).json();
  const res = await guardar(3333, { idComprobante: data.idComprobante, cobrarIdUnico: 'mov_de_otro', movimiento: { descripcion: 'x', monto: 1 } });
  expect(res.status).toBe(400);
});

test('respeta la cuota diaria de IA', async () => {
  const limite = aiQuota.limiteDe('media');
  for (let i = 0; i < limite; i++) aiQuota.consumir(2222, 'media');
  expect((await leer(2222)).status).toBe(429);
});

// ── Transferencia ENVIADA (egreso) ──────────────────────────────────────────
const ENVIADA = { pagador: 'Matías Dueño', destinatario: 'Pinturería Sur', monto: 18000, moneda: 'Pesos', numeroOperacion: '987', fecha: '02/10/2026', direccion: 'enviada', concepto: 'pintura' };

test('transferencia enviada: es un egreso, no busca pendientes de pacientes y ofrece Personal al dueño', async () => {
  const cmd = require('../src/services/command.service');
  vision.extraerTransferencia.mockResolvedValueOnce({ transferencia: ENVIADA });
  const data = await (await leer(2222, 'transferencia')).json();

  expect(data.tipoMovimiento).toBe('egreso');
  expect(data.pendientes).toEqual([]);
  expect(cmd.buscarPendientesDePagador).not.toHaveBeenCalled();
  expect(data.sugerido).toMatchObject({ monto: 18000, proveedor: 'Pinturería Sur', paciente: '', metodoPago: 'transferencia' });
  expect(data.puedePersonal).toBe(true);
});

test('transferencia recibida sigue siendo ingreso y no ofrece Personal', async () => {
  const data = await (await leer(2222, 'transferencia')).json();
  expect(data.tipoMovimiento).toBe('ingreso');
  expect(data.puedePersonal).toBe(false);
});

test('guardar una transferencia enviada en consultorio: se guarda como EGRESO con el destinatario de proveedor', async () => {
  vision.extraerTransferencia.mockResolvedValueOnce({ transferencia: ENVIADA });
  const { idComprobante } = await (await leer(3333, 'transferencia')).json();
  const res = await guardar(3333, { idComprobante, movimiento: { descripcion: 'Transferencia a Pinturería Sur', monto: 18000, moneda: 'Pesos', metodoPago: 'transferencia', proveedor: 'Pinturería Sur' } });
  expect(res.status).toBe(201);
  expect(guardarMovimiento).toHaveBeenCalledWith('3333', expect.objectContaining({
    monto: -18000, tipo: 'Egreso', proveedorNombre: 'Pinturería Sur', pacienteNombre: null, pagadorNombre: null,
  }));
});

test('guardar una transferencia enviada como Personal (dueño)', async () => {
  vision.extraerTransferencia.mockResolvedValueOnce({ transferencia: ENVIADA });
  const { idComprobante } = await (await leer(2222, 'transferencia')).json();
  const res = await guardar(2222, { idComprobante, movimiento: { descripcion: 'Transferencia a Pinturería Sur', monto: 18000, ambito: 'personal', categoria: 'otros' } });
  expect(res.status).toBe(201);
  expect(personalService.registrarMovimientoPersonal).toHaveBeenCalledWith('2222', expect.objectContaining({ tipo: 'gasto', monto: 18000 }));
});

test('una transferencia RECIBIDA no puede guardarse como Personal aunque el cliente lo pida', async () => {
  const { idComprobante } = await (await leer(2222, 'transferencia')).json();
  await guardar(2222, { idComprobante, movimiento: { descripcion: 'Transferencia', monto: 30000, ambito: 'personal' } });
  expect(personalService.registrarMovimientoPersonal).not.toHaveBeenCalled();
  expect(guardarMovimiento).toHaveBeenCalledWith('2222', expect.objectContaining({ tipo: 'Ingreso', monto: 30000 }));
});

test('una transferencia enviada no se puede usar para cobrar un pendiente', async () => {
  vision.extraerTransferencia.mockResolvedValueOnce({ transferencia: ENVIADA });
  const data = await (await leer(3333, 'transferencia')).json();
  const res = await guardar(3333, { idComprobante: data.idComprobante, cobrarIdUnico: 'mov_pend', movimiento: { descripcion: 'x', monto: 1 } });
  expect(res.status).toBe(400);
});
