import { useState } from 'react'
import { motivosFrecuentes, separarMotivos, juntarMotivos } from '../utils/motivos'

/**
 * Motivo de la consulta: se tildan los habituales y, si hace falta algo distinto, "Otro" abre un
 * campo para escribirlo. Entrega UN texto (ej. "Control, Limpieza, Prótesis parcial") por onChange,
 * que es el mismo campo `servicio` de siempre.
 *
 * Toma `valorInicial` una sola vez: el modal que lo usa se monta de nuevo cada vez que se abre.
 */
export default function MotivoConsulta({ valorInicial = '', onChange }) {
  const opciones = motivosFrecuentes()
  const [{ tildados, otro, otroAbierto }, setEstado] = useState(() => {
    const inicial = separarMotivos(valorInicial, opciones)
    return { ...inicial, otroAbierto: inicial.otro !== '' }
  })

  function actualizar(siguiente) {
    setEstado(siguiente)
    onChange(juntarMotivos(siguiente.tildados, siguiente.otroAbierto ? siguiente.otro : '', opciones))
  }

  function alternar(motivo) {
    const nuevos = tildados.includes(motivo) ? tildados.filter(m => m !== motivo) : [...tildados, motivo]
    actualizar({ tildados: nuevos, otro, otroAbierto })
  }

  function alternarOtro() {
    // Al destildar "Otro" se descarta lo escrito: lo que no se ve no tiene que viajar.
    actualizar({ tildados, otro: otroAbierto ? '' : otro, otroAbierto: !otroAbierto })
  }

  return (
    <div>
      <div className="motivos" role="group" aria-label="Motivo de la consulta">
        {opciones.map(m => (
          <label key={m} className={`chip motivo-chip${tildados.includes(m) ? ' active' : ''}`}>
            <input type="checkbox" checked={tildados.includes(m)} onChange={() => alternar(m)} />
            {m}
          </label>
        ))}
        <label className={`chip motivo-chip${otroAbierto ? ' active' : ''}`}>
          <input type="checkbox" checked={otroAbierto} onChange={alternarOtro} />
          Otro…
        </label>
      </div>
      {otroAbierto && (
        <input
          className="form-input"
          style={{ marginTop: 8 }}
          value={otro}
          onChange={e => actualizar({ tildados, otro: e.target.value, otroAbierto })}
          placeholder="Escribí el motivo"
          maxLength={100}
          autoFocus
        />
      )}
    </div>
  )
}
