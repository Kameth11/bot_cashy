// Convierte fecha "DD/MM/YYYY" + hora "HH:MM" de un movimiento en un timestamp
// comparable. Devuelve 0 si la fecha no es parseable (esos quedan al final).
function fechaHoraTimestamp(mov) {
  const [d, m, y] = String(mov.fecha || '').split('/').map(Number)
  if (!d || !m || !y) return 0
  const [hh, mm] = String(mov.hora || '').split(':').map(Number)
  return new Date(y, m - 1, d, hh || 0, mm || 0).getTime()
}

// Ordena movimientos del mas reciente al mas antiguo (por fecha + hora).
export function ordenarPorFechaDesc(movimientos) {
  return [...movimientos].sort((a, b) => fechaHoraTimestamp(b) - fechaHoraTimestamp(a))
}
