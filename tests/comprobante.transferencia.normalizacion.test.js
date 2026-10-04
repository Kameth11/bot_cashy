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


describe('dirección de la transferencia', () => {
  const { normalizarTransferencia } = require('../src/services/comprobante-vision.service');
  const dir = (direccion) => normalizarTransferencia({ monto: 1, direccion }).direccion;

  test.each([
    ['enviada', 'enviada'], ['Enviado', 'enviada'], ['envió', 'enviada'], ['saliente', 'enviada'], ['débito', 'enviada'],
    ['recibida', 'recibida'], ['Recibido', 'recibida'], ['entrante', 'recibida'], ['acreditada', 'recibida'],
  ])('%s -> %s', (entrada, esperado) => expect(dir(entrada)).toBe(esperado));

  test.each([null, undefined, '', 'no se sabe', 'otra cosa'])('%p -> null (no se adivina)', (entrada) => {
    expect(dir(entrada)).toBeNull();
  });

  test('el prompt ya no asume que el comprobante es siempre un cobro', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../src/services/comprobante-vision.service'), 'utf8');
    expect(src).not.toMatch(/es de un pago que RECIBE un consultorio/);
    expect(src).toMatch(/"direccion": "enviada" \| "recibida" \| null/);
  });
});

describe('transferenciaAEntities según la dirección', () => {
  const { transferenciaAEntities, datosDuplicadoTransferencia, textoParaAmbitoTransferencia } = require('../src/services/comprobante.service');
  const base = { pagador: 'Matías', cuitPagador: '20-1-3', destinatario: 'Edenor S.A.', monto: 9000, moneda: 'Pesos', fecha: '02/10/2026', numeroOperacion: '55', banco: 'Galicia', concepto: 'luz' };

  test('recibida (o sin dato): ingreso con el pagador como paciente', () => {
    for (const direccion of ['recibida', null, undefined]) {
      const e = transferenciaAEntities({ ...base, direccion }, { idComprobante: 'c1' });
      expect(e).toMatchObject({ tipo: 'ingreso', pacienteNombre: 'Matías', pagadorNombre: 'Matías' });
    }
  });

  test('enviada: egreso, el destinatario es el proveedor', () => {
    const e = transferenciaAEntities({ ...base, direccion: 'enviada', destinatario: 'Pinturería Sur' }, { idComprobante: 'c1' });
    expect(e).toMatchObject({ tipo: 'gasto', proveedorNombre: 'Pinturería Sur', pacienteNombre: null, descripcion: 'Transferencia a Pinturería Sur', categoria: 'otro_egreso' });
    expect(e.referenciaId).toBe('comp:c1');
  });

  test('enviada a una empresa de servicios: categoría servicios', () => {
    expect(transferenciaAEntities({ ...base, direccion: 'enviada' }, { idComprobante: 'c1' }).categoria).toBe('servicios');
  });

  test('enviada sin destinatario legible: descripción genérica', () => {
    expect(transferenciaAEntities({ ...base, direccion: 'enviada', destinatario: null }, { idComprobante: 'c1' }).descripcion).toBe('Transferencia enviada');
  });

  test('duplicados: se busca por el pagador si es recibida y por el destinatario si es enviada', () => {
    expect(datosDuplicadoTransferencia({ ...base, direccion: 'recibida' })).toEqual({ cuit: '20-1-3', emisor: 'Matías' });
    expect(datosDuplicadoTransferencia({ ...base, direccion: 'enviada' })).toEqual({ cuit: null, emisor: 'Edenor S.A.' });
  });

  test('texto para el ámbito: destinatario, concepto y banco', () => {
    expect(textoParaAmbitoTransferencia({ ...base, direccion: 'enviada' })).toBe('Edenor S.A. luz Galicia');
  });
});
