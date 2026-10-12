// Plan de cuotas: un tratamiento de $300.000 en 6 cuotas = 6 movimientos de $50.000, uno por mes.
//
// Reglas (acordadas con el dueño):
//   - El monto que se escribe es el TOTAL; el sistema lo divide.
//   - La primera cuota queda cobrada hoy (si el paciente ya pagó la primera) y las demás pendientes,
//     con vencimiento mes a mes. Se puede dejar todas pendientes.
//   - La suma de las cuotas es SIEMPRE el total exacto: la última absorbe lo que sobra del redondeo.
//
// Todo en centavos enteros para no arrastrar errores de coma flotante. Las fechas son 'AAAA-MM-DD'.

const MIN_CUOTAS = 1;
const MAX_CUOTAS = 24;

function esFechaIso(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(`${valor}T00:00:00Z`))
    && new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) === valor;
}

/**
 * Reparte `total` en `cantidad` partes de centavos enteros que suman EXACTO el total. Las primeras
 * partes son iguales; la última absorbe la diferencia del redondeo.
 * @returns {number[]} montos (en la misma unidad que `total`, con 2 decimales)
 */
function repartirCuotas(total, cantidad) {
  const centavos = Math.round(Math.abs(Number(total)) * 100);
  const n = Math.trunc(Number(cantidad));
  if (!Number.isFinite(centavos) || centavos <= 0) throw new Error('total_invalido');
  if (!Number.isInteger(n) || n < MIN_CUOTAS || n > MAX_CUOTAS) throw new Error('cantidad_invalida');

  const base = Math.floor(centavos / n);
  const partes = Array(n).fill(base);
  partes[n - 1] += centavos - base * n;
  return partes.map(c => c / 100);
}

/** Suma `meses` a una fecha 'AAAA-MM-DD'. Si el día no existe en el mes destino (31 + 1 mes), queda el último día. */
function sumarMeses(fechaIso, meses) {
  if (!esFechaIso(fechaIso)) throw new Error('fecha_invalida');
  const [a, m, d] = fechaIso.split('-').map(Number);
  const destino = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(d, ultimoDia));
  return destino.toISOString().slice(0, 10);
}

/**
 * Arma el plan: una entrada por cuota.
 * @param {{total:number, cantidad:number, primerVencimiento:string, primeraCobrada?:boolean}} p
 * @returns {{numero:number, de:number, monto:number, vencimiento:string, estado:'Cobrado'|'Pendiente'}[]}
 */
function planDeCuotas({ total, cantidad, primerVencimiento, primeraCobrada = true }) {
  const montos = repartirCuotas(total, cantidad);
  return montos.map((monto, i) => ({
    numero: i + 1,
    de: montos.length,
    monto,
    vencimiento: sumarMeses(primerVencimiento, i),
    estado: i === 0 && primeraCobrada ? 'Cobrado' : 'Pendiente',
  }));
}

module.exports = { MIN_CUOTAS, MAX_CUOTAS, esFechaIso, repartirCuotas, sumarMeses, planDeCuotas };
