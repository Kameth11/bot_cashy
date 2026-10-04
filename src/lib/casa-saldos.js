// Saldos de una CASA (gastos compartidos). Funciones puras, sin I/O.
//
// Todo se calcula en centavos enteros para no perder plata al repartir
// ($100 entre 3 = 3333 + 3333 + 3334 centavos, nunca 33.33 * 3). Cada moneda
// se calcula por separado y NO se convierte: si hay gastos en Euros y en
// Pesos, los saldos quedan en cada moneda (se saldan por separado).
//
// Convención: saldo > 0 = al miembro le deben plata; saldo < 0 = debe plata.
// La suma de saldos de una moneda es siempre 0.
//
// Movimientos:
//   gasto:       { tipo:'gasto', monto, moneda, pagoPor, repartoEntre:[ids] | 'todos' }
//   liquidacion: { tipo:'liquidacion', monto, moneda, pagoPor, para }
//                (pagoPor le entregó `monto` a `para` para saldar deuda)

const aCentavos = (monto) => Math.round(Number(monto) * 100);
const aUnidades = (centavos) => centavos / 100;

function participantes(mov, idsMiembros) {
  const r = mov.repartoEntre;
  if (Array.isArray(r) && r.length > 0) return [...new Set(r.map(String))];
  // 'todos' o vacío: todos los miembros actuales. (Al registrar un gasto el
  // servicio ya expande 'todos' a ids explícitos, para que quien se une
  // después no herede gastos viejos.)
  return idsMiembros;
}

// Reparte `centavos` entre `ids` sin perder ni crear centavos. El resto
// (1 o 2 centavos) lo absorbe el pagador si participa; si no, el primero.
function repartir(centavos, ids, pagador) {
  const base = Math.floor(centavos / ids.length);
  const resto = centavos - base * ids.length;
  const partes = new Map(ids.map((id) => [id, base]));
  if (resto > 0) {
    const receptor = ids.includes(pagador) ? pagador : ids[0];
    partes.set(receptor, partes.get(receptor) + resto);
  }
  return partes;
}

// Pocas transferencias para dejar todos los saldos en 0: el que más debe le
// paga al que más le deben, y se repite. Es la heurística estándar; no
// garantiza el mínimo absoluto de transferencias, pero sí que queda saldado.
function simplificar(saldos) {
  const deudores = [];
  const acreedores = [];
  for (const [id, c] of saldos) {
    if (c < 0) deudores.push({ id, c: -c });
    else if (c > 0) acreedores.push({ id, c });
  }
  const porMonto = (a, b) => b.c - a.c || String(a.id).localeCompare(String(b.id));
  deudores.sort(porMonto);
  acreedores.sort(porMonto);

  const transferencias = [];
  let i = 0;
  let j = 0;
  while (i < deudores.length && j < acreedores.length) {
    const monto = Math.min(deudores[i].c, acreedores[j].c);
    transferencias.push({ de: deudores[i].id, para: acreedores[j].id, monto: aUnidades(monto) });
    deudores[i].c -= monto;
    acreedores[j].c -= monto;
    if (deudores[i].c === 0) i++;
    if (acreedores[j].c === 0) j++;
  }
  return transferencias;
}

/**
 * @param {Array<{id:string}>} miembros  miembros actuales de la casa
 * @param {Array<object>} movimientos    gastos y liquidaciones
 * @returns {{ porMoneda: Object<string,{saldos:Array<{id,saldo}>, transferencias:Array, totalGastado:number}>, ignorados:number }}
 */
function calcularSaldos(miembros, movimientos) {
  const idsMiembros = (miembros || []).map((m) => String(m.id));
  const monedas = new Map(); // moneda -> { saldos: Map(id->centavos), gastado }
  let ignorados = 0;

  const estado = (moneda) => {
    if (!monedas.has(moneda)) {
      monedas.set(moneda, { saldos: new Map(idsMiembros.map((id) => [id, 0])), gastado: 0 });
    }
    return monedas.get(moneda);
  };
  const sumar = (saldos, id, c) => saldos.set(id, (saldos.get(id) || 0) + c);

  for (const mov of movimientos || []) {
    const centavos = aCentavos(mov && mov.monto);
    const pagador = mov && mov.pagoPor != null ? String(mov.pagoPor) : null;
    if (!mov || !Number.isFinite(centavos) || centavos <= 0 || !pagador) { ignorados++; continue; }
    const { saldos } = estado(mov.moneda || 'Pesos');

    if (mov.tipo === 'liquidacion') {
      if (mov.para == null || String(mov.para) === pagador) { ignorados++; continue; }
      sumar(saldos, pagador, centavos);
      sumar(saldos, String(mov.para), -centavos);
    } else {
      const ids = participantes(mov, idsMiembros);
      if (ids.length === 0) { ignorados++; continue; }
      sumar(saldos, pagador, centavos);
      for (const [id, parte] of repartir(centavos, ids, pagador)) sumar(saldos, id, -parte);
      monedas.get(mov.moneda || 'Pesos').gastado += centavos;
    }
  }

  const porMoneda = {};
  for (const [moneda, { saldos, gastado }] of monedas) {
    porMoneda[moneda] = {
      saldos: [...saldos].map(([id, c]) => ({ id, saldo: aUnidades(c) })),
      transferencias: simplificar(saldos),
      totalGastado: aUnidades(gastado),
    };
  }
  return { porMoneda, ignorados };
}

module.exports = { calcularSaldos, repartir, simplificar, aCentavos };
