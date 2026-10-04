// Selector de meses compartido por las vistas Personal y Casa.

export function claveMes(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`
}

export function etiquetaMes(clave) {
  const [a, m] = clave.split('-').map(Number)
  // Se arma a mano en vez de con toLocaleDateString({month:'long',year:'2-digit'}),
  // que en es-AR devuelve "julio de 26".
  const nombre = new Date(a, m - 1, 1).toLocaleDateString('es-AR', { month: 'long' })
  const esteAnio = new Date().getFullYear()
  const capitalizado = nombre.charAt(0).toUpperCase() + nombre.slice(1)
  return a === esteAnio ? capitalizado : `${capitalizado} ${String(a).slice(-2)}`
}

// Tres meses desde el actual hacia atrás. Con pocos botones se reparten parejo
// el ancho y se leen bien en el celular; con seis quedaban apretados e
// ilegibles. Para cualquier mes más viejo está el calendario.
export function mesesRecientes(cantidad = 3) {
  const hoy = new Date()
  return Array.from({ length: cantidad }, (_, i) =>
    claveMes(new Date(hoy.getFullYear(), hoy.getMonth() - i, 1))
  )
}
