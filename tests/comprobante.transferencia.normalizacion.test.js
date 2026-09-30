const { normalizarTransferencia } = require('../src/services/comprobante-vision.service');
const { transferenciaAEntities } = require('../src/services/comprobante.service');

describe('normalizarTransferencia', () => {
  test('monto argentino, fecha y hora', () => {
    const t = normalizarTransferencia({ pagador: '  JUAN  PEREZ ', monto: '30.000,50', fecha: '2026-09-30', hora: '9:05', moneda: 'ARS', banco: 'Mercado Pago', numeroOperacion: '123456' });
    expect(t).toMatchObject({ pagador: 'JUAN PEREZ', monto: 30000.5, fecha: '30/09/2026', hora: '09:05', moneda: 'Pesos', banco: 'Mercado Pago', numeroOperacion: '123456' });
  });
  test('dólares y CUIT/DNI', () => {
    expect(normalizarTransferencia({ monto: 50, moneda: 'USD' }).moneda).toBe('Dólares');
    expect(normalizarTransferencia({ cuitPagador: '20-12345678-9' }).cuitPagador).toBe('20-12345678-9');
    expect(normalizarTransferencia({ cuitPagador: '12345678' }).cuitPagador).toBe('12345678');
    expect(normalizarTransferencia({ cuitPagador: '12' }).cuitPagador).toBeNull();
  });
  test('datos ausentes o basura -> null, sin explotar', () => {
    const t = normalizarTransferencia({ monto: 'abc', fecha: 'ayer', hora: '99:99' });
    expect(t).toMatchObject({ pagador: null, monto: null, fecha: null, hora: null });
    expect(normalizarTransferencia(null).monto).toBeNull();
  });
});

describe('transferenciaAEntities', () => {
  test('arma un ingreso Cobrado por transferencia, ligado al comprobante', () => {
    const e = transferenciaAEntities(
      { pagador: 'Juan Perez', monto: 30000, moneda: 'Pesos', fecha: '30/09/2026', cuitPagador: null, numeroOperacion: '99', banco: 'Galicia' },
      { idComprobante: 'comp_1', hash: 'h', archivo: 'tg:abc', mimeType: 'image/jpeg' }
    );
    expect(e).toMatchObject({
      tipo: 'ingreso', monto: 30000, metodo_pago: 'transferencia', estado: 'Cobrado',
      pacienteNombre: 'Juan Perez', ambito: 'consultorio', referenciaId: 'comp:comp_1',
    });
    expect(e.comprobante).toMatchObject({ id: 'comp_1', tipo: 'transferencia', numero: '99', hash: 'h', archivo: 'tg:abc' });
  });
});
