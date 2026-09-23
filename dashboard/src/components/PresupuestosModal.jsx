import { useState, useMemo } from 'react'
import { etiquetaCategoria, formatPesos } from '../utils/format'

/**
 * Editor de presupuestos mensuales por categoría.
 * Guardar en 0 desactiva el presupuesto sin perder el registro, así que no hace
 * falta un botón de borrar aparte.
 */
export default function PresupuestosModal({
  categorias,
  presupuestos,
  guardando,
  error,
  onGuardar,
  onCerrar,
}) {
  const [categoria, setCategoria] = useState('')
  const [monto, setMonto] = useState('')
  const [validationError, setValidationError] = useState(null)

  const definidos = useMemo(
    () => new Map((presupuestos || []).map(p => [p.categoria, p])),
    [presupuestos]
  )

  const opciones = useMemo(
    () => (categorias?.egreso || []).map(c => ({
      value: c,
      label: etiquetaCategoria(c),
      actual: definidos.get(c)?.limite || null,
    })),
    [categorias, definidos]
  )

  function handleSubmit(e) {
    e.preventDefault()
    setValidationError(null)

    if (!categoria) {
      setValidationError('Elegí una categoría.')
      return
    }
    const montoNum = parseFloat(monto)
    if (!Number.isFinite(montoNum) || montoNum < 0) {
      setValidationError('Ingresá un monto de 0 o más. Cero desactiva el presupuesto.')
      return
    }

    onGuardar({ categoria, montoMensual: montoNum })
    setMonto('')
  }

  // Al elegir una categoría que ya tiene presupuesto, se precarga su valor.
  function elegirCategoria(value) {
    setCategoria(value)
    const existente = definidos.get(value)
    setMonto(existente ? String(existente.limite) : '')
  }

  const mensajeError = validationError || error

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">Presupuestos mensuales</h2>

        <form onSubmit={handleSubmit} className="modal-form">
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Categoría *</label>
              <select
                className="form-input"
                value={categoria}
                onChange={e => elegirCategoria(e.target.value)}
                required
                autoFocus
              >
                <option value="" disabled>Elegí una</option>
                {opciones.map(c => (
                  <option key={c.value} value={c.value}>
                    {c.label}{c.actual ? ` · ${formatPesos(c.actual)}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Límite mensual *</label>
              <input
                className="form-input"
                type="number"
                step="1000"
                min="0"
                placeholder="0"
                value={monto}
                onChange={e => setMonto(e.target.value)}
                required
              />
            </div>
          </div>

          <p className="presu-hint">
            Poné <strong>0</strong> para desactivar el presupuesto de una categoría.
            Te aviso por Telegram cuando llegues al 80%.
          </p>

          {(presupuestos || []).length > 0 && (
            <div className="presu-lista">
              <label className="form-label">Definidos</label>
              {presupuestos.map(p => (
                <div key={p.categoria} className="presu-lista-item">
                  <span>{etiquetaCategoria(p.categoria)}</span>
                  <span className="presu-lista-monto">
                    {formatPesos(p.gastado)} de {formatPesos(p.limite)}
                    {' '}
                    <span style={{ color: p.excedido ? 'var(--red)' : p.enAlerta ? 'var(--amber)' : 'var(--text-3)' }}>
                      ({p.porcentaje}%)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {mensajeError && <div className="error-box">{mensajeError}</div>}

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onCerrar}>Cerrar</button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar presupuesto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
