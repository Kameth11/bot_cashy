import { useState, useEffect, useMemo } from 'react'
import { api } from '../services/api'
import { etiquetaCategoria } from '../utils/format'

function Seg({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className={`seg-btn${active ? ' active' : ''}`}>
      {children}
    </button>
  )
}

const initialState = {
  descripcion: '',
  monto: '',
  moneda: 'Pesos',
  categoria: '',
  metodoPago: '',
  fecha: '',
}

// DD/MM/AAAA (lo que entrega la API) -> AAAA-MM-DD (lo que usa <input type="date">)
const aInputFecha = (f) => {
  const m = String(f || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

function formularioDesde(m) {
  if (!m) return initialState
  return {
    descripcion: m.descripcion || '',
    monto: m.monto != null ? String(m.monto) : '',
    moneda: m.moneda || 'Pesos',
    categoria: m.categoria || '',
    metodoPago: m.metodoPago || '',
    fecha: aInputFecha(m.fecha),
  }
}

/**
 * Alta de un gasto compartido, o su edición si llega `inicial` (un gasto existente). Por defecto paga quien lo carga y se reparte
 * entre todos los miembros; los dos se pueden cambiar. Los miembros y las
 * categorías se piden acá mismo para que el modal sea autosuficiente.
 */
export default function NuevoCasaModal({ casaId, guardando, error, onGuardar, onCerrar, inicial = null }) {
  const editando = Boolean(inicial)
  const [form, setForm] = useState(() => formularioDesde(inicial))
  const [miembros, setMiembros] = useState(null)
  const [categorias, setCategorias] = useState([])
  const [pagoPor, setPagoPor] = useState('')
  const [excluidos, setExcluidos] = useState(() => new Set())
  const [validationError, setValidationError] = useState(null)
  const [cargaError, setCargaError] = useState(null)

  useEffect(() => {
    let active = true
    Promise.all([
      api.get(`/api/casa/${casaId}/miembros`),
      api.get('/api/casa/categorias'),
    ])
      .then(([m, c]) => {
        if (!active) return
        setMiembros(m.data.miembros)
        setPagoPor(inicial?.pagoPor || m.data.yo?.id || m.data.miembros[0]?.id || '')
        // Editando: quedan tildados solo los que participaban de ese gasto.
        if (inicial) {
          const participan = new Set(inicial.repartoEntre || [])
          setExcluidos(new Set(m.data.miembros.filter(x => !participan.has(x.id)).map(x => x.id)))
        }
        setCategorias(c.data.egreso || [])
      })
      .catch(err => {
        if (active) setCargaError(err?.response?.data?.error || 'No se pudo cargar la casa')
      })
    return () => { active = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casaId])

  const opciones = useMemo(
    () => categorias.map(c => ({ value: c, label: etiquetaCategoria(c) })),
    [categorias]
  )

  const update = (field) => (e) => {
    const value = e.target.value
    setForm(f => ({ ...f, [field]: value }))
  }

  function alternarMiembro(id) {
    setExcluidos(prev => {
      const siguiente = new Set(prev)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
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

    const participantes = (miembros || []).filter(m => !excluidos.has(m.id)).map(m => m.id)
    if (participantes.length === 0) {
      setValidationError('El gasto tiene que repartirse entre al menos una persona.')
      return
    }

    if (editando) {
      // En edición solo viajan los campos que el usuario cambió.
      const orig = formularioDesde(inicial)
      const cambios = {}
      if (descripcion !== orig.descripcion) cambios.descripcion = descripcion
      if (montoNum !== Number(orig.monto)) cambios.monto = montoNum
      if (form.moneda !== orig.moneda) cambios.moneda = form.moneda
      if (form.categoria && form.categoria !== orig.categoria) cambios.categoria = form.categoria
      if (form.metodoPago !== orig.metodoPago) cambios.metodoPago = form.metodoPago
      if (form.fecha && form.fecha !== orig.fecha) cambios.fecha = form.fecha
      if (pagoPor && pagoPor !== inicial.pagoPor) cambios.pagoPor = pagoPor
      const antes = [...(inicial.repartoEntre || [])].sort().join(',')
      if ([...participantes].sort().join(',') !== antes) cambios.repartoEntre = participantes
      if (Object.keys(cambios).length === 0) { onCerrar(); return }
      onGuardar(cambios)
      return
    }

    onGuardar({
      descripcion,
      monto: montoNum,
      moneda: form.moneda,
      categoria: form.categoria || undefined,
      metodoPago: form.metodoPago,
      fecha: form.fecha || undefined,
      pagoPor: pagoPor || undefined,
      // Todos tildados = reparto general (los que se sumen después no lo heredan:
      // el servidor guarda los ids explícitos igual).
      repartoEntre: participantes.length === (miembros || []).length ? undefined : participantes,
    })
  }

  const mensajeError = validationError || error || cargaError

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">{editando ? '✏️ Editar gasto de la casa' : '🏡 Nuevo gasto de la casa'}</h2>

        <form onSubmit={handleSubmit} className="modal-form">
          <div>
            <label className="form-label">Descripción *</label>
            <input
              className="form-input"
              value={form.descripcion}
              onChange={update('descripcion')}
              placeholder="Ej: Supermercado del sábado"
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
              <label className="form-label">Categoría</label>
              <select className="form-input" value={form.categoria} onChange={update('categoria')}>
                <option value="">Sin categoría</option>
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Pagó</label>
              <select className="form-input" value={pagoPor} onChange={e => setPagoPor(e.target.value)} disabled={!miembros}>
                {(miembros || []).map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Fecha</label>
              <input className="form-input" type="date" value={form.fecha} onChange={update('fecha')} />
            </div>
          </div>

          <div>
            <label className="form-label">Se reparte entre</label>
            <div className="casa-reparto">
              {(miembros || []).map(m => (
                <label key={m.id} className="casa-reparto-item">
                  <input
                    type="checkbox"
                    checked={!excluidos.has(m.id)}
                    onChange={() => alternarMiembro(m.id)}
                  />
                  {m.nombre}
                </label>
              ))}
              {!miembros && !cargaError && <span className="pers-item-meta">Cargando...</span>}
            </div>
          </div>

          {mensajeError && <div className="error-box">{mensajeError}</div>}

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={guardando || !miembros}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
