import { useState, useMemo } from 'react'
import { etiquetaCategoria } from '../utils/format'

function Seg({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className={`seg-btn${active ? ' active' : ''}`}>
      {children}
    </button>
  )
}

const initialState = {
  tipo: 'Egreso',
  descripcion: '',
  monto: '',
  moneda: 'Pesos',
  metodoPago: '',
  categoria: '',
  comercio: '',
}

/**
 * Alta de un movimiento personal. Es un formulario propio y más corto que el
 * del consultorio: acá no hay paciente, profesional, estado ni fechas de
 * prestación/vencimiento.
 */
export default function NuevoPersonalModal({ categorias, guardando, error, onGuardar, onCerrar }) {
  const [form, setForm] = useState(initialState)
  const [validationError, setValidationError] = useState(null)

  const opciones = useMemo(() => {
    const lista = form.tipo === 'Egreso' ? (categorias?.egreso || []) : (categorias?.ingreso || [])
    return lista.map(c => ({ value: c, label: etiquetaCategoria(c) }))
  }, [form.tipo, categorias])

  const update = (field) => (e) => {
    const value = e.target.value
    setForm(f => ({ ...f, [field]: value }))
  }

  function cambiarTipo(tipo) {
    // Las categorías de ingreso y egreso son disjuntas: al cambiar de tipo la
    // elegida deja de ser válida.
    setForm(f => ({ ...f, tipo, categoria: '' }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    setValidationError(null)

    const descripcion = form.descripcion.trim()
    if (descripcion.length < 2) {
      setValidationError('Escribí una descripción de al menos 2 caracteres.')
      return
    }

    const montoNum = parseFloat(form.monto)
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      setValidationError('Ingresá un monto válido mayor a 0.')
      return
    }

    if (!form.categoria) {
      setValidationError('Elegí una categoría.')
      return
    }

    onGuardar({
      tipo: form.tipo,
      descripcion,
      monto: montoNum,
      moneda: form.moneda,
      metodoPago: form.metodoPago,
      categoria: form.categoria,
      comercio: form.comercio.trim(),
    })
  }

  const mensajeError = validationError || error

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">🏠 Nuevo movimiento personal</h2>

        <form onSubmit={handleSubmit} className="modal-form">
          <div>
            <label className="form-label">Tipo</label>
            <div className="seg-group">
              <Seg active={form.tipo === 'Egreso'}  onClick={() => cambiarTipo('Egreso')}>↓ Gasto</Seg>
              <Seg active={form.tipo === 'Ingreso'} onClick={() => cambiarTipo('Ingreso')}>↑ Ingreso</Seg>
            </div>
          </div>

          <div>
            <label className="form-label">Descripción *</label>
            <input
              className="form-input"
              value={form.descripcion}
              onChange={update('descripcion')}
              placeholder={form.tipo === 'Egreso' ? 'Ej: Supermercado del sábado' : 'Ej: Sueldo de julio'}
              maxLength={200}
              autoFocus
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Moneda</label>
              <div className="seg-group">
                {['Pesos', 'Dólares', 'Euros'].map(m => (
                  <Seg key={m} active={form.moneda === m} onClick={() => setForm(f => ({ ...f, moneda: m }))}>
                    {m === 'Pesos' ? 'ARS' : m === 'Dólares' ? 'USD' : 'EUR'}
                  </Seg>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">Monto *</label>
              <input
                className="form-input"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0"
                value={form.monto}
                onChange={update('monto')}
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Categoría *</label>
              <select className="form-input" value={form.categoria} onChange={update('categoria')} required>
                <option value="" disabled>Elegí una</option>
                {opciones.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Método de pago</label>
              <select className="form-input" value={form.metodoPago} onChange={update('metodoPago')}>
                <option value="">Sin especificar</option>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="debito">Débito</option>
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">Comercio</label>
            <input
              className="form-input"
              value={form.comercio}
              onChange={update('comercio')}
              placeholder="Ej: Coto, YPF, Netflix"
              maxLength={100}
            />
          </div>

          {mensajeError && <div className="error-box">{mensajeError}</div>}

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
