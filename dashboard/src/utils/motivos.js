// Motivos de consulta más habituales, para tildar en vez de escribir (Agenda → turno).
// Hoy es una lista fija. Pendiente (a propósito, "lo vemos después"): que los motivos que se repiten
// al escribirlos en "Otro" se puedan guardar como opciones propias del consultorio; cuando exista,
// `motivosFrecuentes()` es el único lugar que tiene que sumarlos.

export const MOTIVOS_BASICOS = [
  'Consulta',
  'Control',
  'Limpieza',
  'Restauración',
  'Extracción',
  'Endodoncia',
  'Ortodoncia',
  'Blanqueamiento',
  'Urgencia',
]

export function motivosFrecuentes() {
  return MOTIVOS_BASICOS
}

const normal = (t) => String(t || '').trim().toLowerCase()

/**
 * El campo "servicio" es un texto: los motivos tildados van separados por coma y, al final, lo que se
 * escribió en "Otro". Esto lo desarma: lo que coincide con un motivo conocido (sin importar mayúsculas)
 * queda tildado; el resto, junto, es el texto de "Otro". Sirve también para turnos viejos con texto libre.
 * @returns {{ tildados: string[], otro: string }}
 */
export function separarMotivos(texto, opciones = motivosFrecuentes()) {
  const conocidos = new Map(opciones.map(o => [normal(o), o]))
  const tildados = []
  const sueltos = []
  for (const parte of String(texto || '').split(',').map(p => p.trim()).filter(Boolean)) {
    const conocido = conocidos.get(normal(parte))
    if (conocido) {
      if (!tildados.includes(conocido)) tildados.push(conocido)
    } else {
      sueltos.push(parte)
    }
  }
  return { tildados, otro: sueltos.join(', ') }
}

/** Inversa de separarMotivos: en el orden de la lista (no del orden en que se tildaron), y "Otro" al final. */
export function juntarMotivos(tildados, otro, opciones = motivosFrecuentes()) {
  const ordenados = opciones.filter(o => tildados.includes(o))
  const extra = String(otro || '').trim()
  return [...ordenados, ...(extra ? [extra] : [])].join(', ')
}
