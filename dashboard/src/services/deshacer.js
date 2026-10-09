import { api } from './api'

// Cada función devuelve una acción para el toast "Deshacer" (ver AppContext.mostrarToast).

// Borrado (uno o varios): se vuelven a cargar con su ID y fecha originales.
// Los que no tienen ID único no se pueden restaurar con fidelidad.
export function deshacerBorrado(movs) {
  const lista = movs.filter(m => m?.idUnico)
  if (lista.length === 0) return null
  return () => api.post('/api/movimientos/restaurar', { movimientos: lista })
}

// Edición: se vuelve a poner el valor anterior de cada campo que se cambió.
export function deshacerEdicion(movAntes, updates) {
  if (!movAntes?.idUnico) return null
  const previo = {}
  if ('descripcion' in updates) previo.descripcion = movAntes.descripcion
  if ('monto' in updates) previo.monto = movAntes.monto
  if ('estado' in updates) previo.estado = movAntes.estado
  if ('metodoPago' in updates) previo.metodoPago = movAntes.metodoPago || ''
  if (Object.keys(previo).length === 0) return null
  return () => api.put(`/api/movimientos/${movAntes.idUnico}`, previo)
}

// Alta: se borra el movimiento recién creado.
export function deshacerAlta(idUnico) {
  if (!idUnico) return null
  return () => api.delete(`/api/movimientos/${idUnico}`)
}
