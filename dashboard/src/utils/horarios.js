// Horarios para elegir al dar un turno: cada 30 minutos, de 08:00 a 22:00 (ambos incluidos).

export const HORA_INICIO = 8
export const HORA_FIN = 22
export const PASO_MINUTOS = 30

const dos = (n) => String(n).padStart(2, '0')

export function horariosDeAgenda() {
  const lista = []
  for (let minutos = HORA_INICIO * 60; minutos <= HORA_FIN * 60; minutos += PASO_MINUTOS) {
    lista.push(`${dos(Math.floor(minutos / 60))}:${dos(minutos % 60)}`)
  }
  return lista
}

/**
 * Los horarios a ofrecer. Si el turno ya tiene una hora que no está en la grilla (cargado antes, por foto
 * de la agenda o desde el bot: 10:15, 07:45...), se agrega en su lugar para que al editar no se pierda ni
 * quede el selector en blanco.
 */
export function opcionesDeHora(actual = '') {
  const lista = horariosDeAgenda()
  const hora = String(actual || '').trim()
  if (!hora || lista.includes(hora)) return lista
  return [...lista, hora].sort()
}
