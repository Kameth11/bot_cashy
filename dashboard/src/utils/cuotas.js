// Vista previa de un plan de cuotas. Es el MISMO cálculo que src/utils/cuotas.js del servidor (que es el que
// manda al guardar): el reparto se hace en centavos enteros, la suma da siempre el total exacto y la última
// cuota absorbe el redondeo. Si se cambia una, hay que cambiar la otra (hay un test de paridad).

export const MIN_CUOTAS = 1
export const MAX_CUOTAS = 24

export function esFechaIso(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)
    && !Number.isNaN(Date.parse(`${valor}T00:00:00Z`))
    && new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) === valor
}

export function repartirCuotas(total, cantidad) {
  const centavos = Math.round(Math.abs(Number(total)) * 100)
  const n = Math.trunc(Number(cantidad))
  if (!Number.isFinite(centavos) || centavos <= 0) throw new Error('total_invalido')
  if (!Number.isInteger(n) || n < MIN_CUOTAS || n > MAX_CUOTAS) throw new Error('cantidad_invalida')

  const base = Math.floor(centavos / n)
  const partes = Array(n).fill(base)
  partes[n - 1] += centavos - base * n
  return partes.map(c => c / 100)
}

export function sumarMeses(fechaIso, meses) {
  if (!esFechaIso(fechaIso)) throw new Error('fecha_invalida')
  const [a, m, d] = fechaIso.split('-').map(Number)
  const destino = new Date(Date.UTC(a, m - 1 + meses, 1))
  const ultimoDia = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate()
  destino.setUTCDate(Math.min(d, ultimoDia))
  return destino.toISOString().slice(0, 10)
}

export function planDeCuotas({ total, cantidad, primerVencimiento, primeraCobrada = true }) {
  const montos = repartirCuotas(total, cantidad)
  return montos.map((monto, i) => ({
    numero: i + 1,
    de: montos.length,
    monto,
    vencimiento: sumarMeses(primerVencimiento, i),
    estado: i === 0 && primeraCobrada ? 'Cobrado' : 'Pendiente',
  }))
}

/** 'AAAA-MM-DD' -> 'DD/MM/AAAA' para mostrar. */
export const fechaCorta = (iso) => (esFechaIso(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')
