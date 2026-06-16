import { useState, useMemo } from 'react'

// ── Shared helpers ─────────────────────────────────────────
function Seg({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className={`seg-btn${active ? ' active' : ''}`}>
      {children}
    </button>
  )
}

const CATEGORIAS_INGRESO = [
  { value: '', label: 'Sin categoría' },
  { value: 'consulta', label: 'Consulta' },
  { value: 'tratamiento', label: 'Tratamiento' },
  { value: 'anticipo', label: 'Anticipo' },
  { value: 'sena', label: 'Seña' },
  { value: 'cuota', label: 'Cuota' },
  { value: 'saldo_final', label: 'Saldo final' },
  { value: 'honorarios', label: 'Honorarios' },
  { value: 'otro_ingreso', label: 'Otro ingreso' },
]

const CATEGORIAS_EGRESO = [
  { value: '', label: 'Sin categoría' },
  { value: 'sueldos', label: 'Sueldos' },
  { value: 'honorarios', label: 'Honorarios' },
  { value: 'insumos', label: 'Insumos' },
  { value: 'alquiler', label: 'Alquiler' },
  { value: 'expensas', label: 'Expensas' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'impuestos', label: 'Impuestos' },
  { value: 'mantenimiento', label: 'Mantenimiento' },
  { value: 'software', label: 'Software' },
  { value: 'otro_egreso', label: 'Otro egreso' },
]

const initialState = {
  tipo: 'Ingreso',
  descripcion: '',
  monto: '',
  moneda: 'Pesos',
  metodoPago: '',
  estado: 'Cobrado',
  categoria: '',
  paciente: '',
  profesional: '',
  tratamiento: '',
  proveedor: '',
  fechaPrestacion: '',
  fechaVencimiento: '',
}

export default function NuevoMovimientoModal({ guardando, error, onGuardar, onCerrar }) {
  const [form, setForm] = useState(initialState)
  const [validationError, setValidationError] = useState(null)

  const categorias = useMemo(
    () => (form.tipo === 'Egreso' ? CATEGORIAS_EGRESO : CATEGORIAS_INGRESO),
    [form.tipo]
  )

  const update = (field) => (e) => {
    const value = e.target.value
    setForm(f => {
      const next = { ...f, [field]: value }
      // Si cambia el tipo, la categoría previa puede no aplicar para el otro tipo
      if (field === 'tipo') next.categoria = ''
      return next
    })
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setValidationError(null)

    const descripcion = form.descripcion.trim()
    if (!descripcion) {
      setValidationError('La descripción es obligatoria.')
      return
    }

    const montoNum = parseFloat(form.monto)
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      setValidationError('Ingresá un monto válido mayor a 0.')
      return
    }

    const payload = {
      tipo: form.tipo,
      descripcion,
      monto: montoNum,
      moneda: form.moneda,
      metodoPago: form.metodoPago,
      estado: form.estado,
      categoria: form.categoria,
      paciente: form.paciente.trim(),
      profesional: form.profesional.trim(),
      tratamiento: form.tratamiento.trim(),
      proveedor: form.proveedor.trim(),
      fechaPrestacion: form.fechaPrestacion,
      fechaVencimiento: form.fechaVencimiento,
    }

    onGuardar(payload)
  }

  const esIngreso   = form.tipo === 'Ingreso'
  const esPendiente = form.estado === 'Pendiente'
  const mensajeError = validationError || error

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">Nuevo movimiento</h2>

        <form onSubmit={handleSubmit} className="modal-form">
          {/* Tipo */}
          <div>
            <label className="form-label">Tipo</label>
            <div className="seg-group">
              <Seg active={form.tipo === 'Ingreso'} onClick={() => setForm(f => ({ ...f, tipo: 'Ingreso', estado: 'Cobrado', categoria: '' }))}>↑ Ingreso</Seg>
              <Seg active={form.tipo === 'Egreso'}  onClick={() => setForm(f => ({ ...f, tipo: 'Egreso',  estado: 'Pagado',  categoria: '' }))}>↓ Egreso</Seg>
            </div>
          </div>

          <div>
            <label className="form-label">Descripción *</label>
            <input className="form-input" value={form.descripcion} onChange={update('descripcion')} placeholder="Ej: Consulta general" maxLength={200} required autoFocus />
          </div>

          <div>
            <label className="form-label">Paciente / Proveedor</label>
            <input className="form-input" value={esIngreso ? form.paciente : form.proveedor} onChange={update(esIngreso ? 'paciente' : 'proveedor')} placeholder={esIngreso ? 'Ej: García, L.' : 'Ej: MediSupply'} maxLength={100} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Moneda</label>
              <div className="seg-group">
                {['Pesos','Dólares','Euros'].map(m => (
                  <Seg key={m} active={form.moneda === m} onClick={() => setForm(f => ({ ...f, moneda: m }))}>
                    {m === 'Pesos' ? 'ARS' : m === 'Dólares' ? 'USD' : 'EUR'}
                  </Seg>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">Monto *</label>
              <input className="form-input" type="number" step="0.01" min="0.01" placeholder="0" value={form.monto} onChange={update('monto')} required />
            </div>
          </div>

          <div>
            <label className="form-label">Estado</label>
            <div className="seg-group">
              {esIngreso
                ? (<><Seg active={form.estado === 'Cobrado'}   onClick={() => setForm(f => ({ ...f, estado: 'Cobrado' }))}>Cobrado</Seg>
                      <Seg active={form.estado === 'Pendiente'} onClick={() => setForm(f => ({ ...f, estado: 'Pendiente' }))}>Pendiente</Seg></>)
                : (<><Seg active={form.estado === 'Pagado'}    onClick={() => setForm(f => ({ ...f, estado: 'Pagado' }))}>Pagado</Seg>
                      <Seg active={form.estado === 'Pendiente'} onClick={() => setForm(f => ({ ...f, estado: 'Pendiente' }))}>Pendiente</Seg></>)
              }
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Método de pago</label>
              <select className="form-input" value={form.metodoPago} onChange={update('metodoPago')}>
                <option value="">Sin especificar</option>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
              </select>
            </div>
            <div>
              <label className="form-label">Categoría</label>
              <select className="form-input" value={form.categoria} onChange={update('categoria')}>
                {categorias.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Fecha prestación</label>
              <input className="form-input" type="date" value={form.fechaPrestacion} onChange={update('fechaPrestacion')} />
            </div>
            {esPendiente && (
              <div>
                <label className="form-label">Vencimiento</label>
                <input className="form-input" type="date" value={form.fechaVencimiento} onChange={update('fechaVencimiento')} />
              </div>
            )}
          </div>

          {mensajeError && <div className="error-box">{mensajeError}</div>}

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar movimiento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
