import { api } from './api'

// Cada función devuelve una acción para el toast "Deshacer" (ver AppContext.mostrarToast).

// Borrado (uno o varios): se vuelven a cargar con su ID y fecha originales.
// Los que no tienen ID único no se pueden restaurar con fidelidad.
export function deshacerBorrado(movs) {
  const lista = movs.filter(m => m?.idUnico)
  if (lista.length === 0) return null
  return () => api.post('/api/movimientos/restaurar', { movimientos: lista })
}

// Campos que se pueden editar (ver PUT /api/movimientos/:id): si se cambió uno, se guarda su valor anterior.
const CAMPOS_EDITABLES = [
  'descripcion', 'monto', 'estado', 'metodoPago', 'moneda', 'tipo', 'categoria',
  'paciente', 'profesional', 'tratamiento', 'proveedor', 'fecha', 'fechaPrestacion', 'fechaVencimiento',
]

// Edición: se vuelve a poner el valor anterior de cada campo que se cambió.
export function deshacerEdicion(movAntes, updates) {
  if (!movAntes?.idUnico) return null
  const previo = {}
  for (const campo of CAMPOS_EDITABLES) {
    if (!(campo in updates)) continue
    // El monto se manda siempre positivo: el servidor le pone el signo según el tipo (también el anterior).
    previo[campo] = campo === 'monto' ? Math.abs(Number(movAntes.monto)) : (movAntes[campo] ?? '')
  }
  if (Object.keys(previo).length === 0) return null
  return () => api.put(`/api/movimientos/${movAntes.idUnico}`, previo)
}

// Alta de un plan de cuotas: se borran todas las cuotas recién creadas.
export function deshacerAltas(ids) {
  const lista = (ids || []).filter(Boolean)
  if (lista.length === 0) return null
  return () => api.post('/api/movimientos/eliminar-lote', { ids: lista })
}

// Alta: se borra el movimiento recién creado.
export function deshacerAlta(idUnico) {
  if (!idUnico) return null
  return () => api.delete(`/api/movimientos/${idUnico}`)
}
