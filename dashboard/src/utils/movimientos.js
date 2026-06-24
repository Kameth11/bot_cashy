// Convierte fecha "DD/MM/YYYY" + hora "HH:MM" de un movimiento en un timestamp
// comparable. Devuelve 0 si la fecha no es parseable (esos quedan al final).
function fechaHoraTimestamp(mov) {
  const [d, m, y] = String(mov.fecha || '').split('/').map(Number)
  if (!d || !m || !y) return 0
  const [hh, mm] = String(mov.hora || '').split(':').map(Number)
  return new Date(y, m - 1, d, hh || 0, mm || 0).getTime()
}

// Convierte "DD/MM/YYYY" (sin hora) en timestamp. Devuelve 0 si no hay fecha.
function fechaCobroTimestamp(mov) {
  const [d, m, y] = String(mov.fechaCobro || '').split('/').map(Number)
  if (!d || !m || !y) return 0
  return new Date(y, m - 1, d).getTime()
}

// Clave de orden: si el movimiento tiene fechaCobro (se cobró un pendiente
// viejo), prioriza esa fecha para que aparezca arriba; si no, usa fecha+hora
// del movimiento como siempre.
function ordenTimestamp(mov) {
  return fechaCobroTimestamp(mov) || fechaHoraTimestamp(mov)
}

// Ordena movimientos del mas reciente al mas antiguo (por fecha de cobro si
// existe, o por fecha + hora del movimiento).
export function ordenarPorFechaDesc(movimientos) {
  return [...movimientos].sort((a, b) => ordenTimestamp(b) - ordenTimestamp(a))
}
