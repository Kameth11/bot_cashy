import { useState, useMemo } from 'react'

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

  const esIngreso = form.tipo === 'Ingreso'
  const esPendiente = form.estado === 'Pendiente'
  const mensajeError = validationError || error

  return (
    <div style={overlayStyle} onClick={onCerrar}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Nuevo movimiento</h3>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Tipo */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {['Ingreso', 'Egreso'].map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setForm(f => ({ ...f, tipo: t, categoria: '' }))}
                style={{
                  flex: 1, padding: '10px', borderRadius: '8px',
                  border: '1px solid #e5e7eb', fontWeight: 700, fontSize: '14px',
                  cursor: 'pointer',
                  background: form.tipo === t
                    ? (t === 'Ingreso' ? '#10b981' : '#ef4444')
                    : '#fff',
                  color: form.tipo === t ? '#fff' : '#374151',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <label style={labelStyle}>
            Descripción
            <input
              style={inputStyle}
              value={form.descripcion}
              onChange={update('descripcion')}
              maxLength={200}
              required
              autoFocus
            />
          </label>

          <div style={{ display: 'flex', gap: '10px' }}>
            <label style={{ ...labelStyle, flex: 2 }}>
              Monto
              <input
                style={inputStyle}
                type="number"
                step="0.01"
                min="0.01"
                value={form.monto}
                onChange={update('monto')}
                required
              />
            </label>
            <label style={{ ...labelStyle, flex: 1 }}>
              Moneda
              <select style={inputStyle} value={form.moneda} onChange={update('moneda')}>
                <option value="Pesos">Pesos</option>
                <option value="Dólares">Dólares</option>
                <option value="Euros">Euros</option>
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <label style={{ ...labelStyle, flex: 1 }}>
              Estado
              <select style={inputStyle} value={form.estado} onChange={update('estado')}>
                <option value="Cobrado">Cobrado</option>
                <option value="Pendiente">Pendiente</option>
              </select>
            </label>
            <label style={{ ...labelStyle, flex: 1 }}>
              Método de pago
              <select style={inputStyle} value={form.metodoPago} onChange={update('metodoPago')}>
                <option value="">Sin especificar</option>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
              </select>
            </label>
          </div>

          <label style={labelStyle}>
            Categoría
            <select style={inputStyle} value={form.categoria} onChange={update('categoria')}>
              {categorias.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>

          {esIngreso ? (
            <div style={{ display: 'flex', gap: '10px' }}>
              <label style={{ ...labelStyle, flex: 1 }}>
                Paciente
                <input style={inputStyle} value={form.paciente} onChange={update('paciente')} maxLength={100} />
              </label>
              <label style={{ ...labelStyle, flex: 1 }}>
                Tratamiento
                <input style={inputStyle} value={form.tratamiento} onChange={update('tratamiento')} maxLength={100} />
              </label>
            </div>
          ) : (
            <label style={labelStyle}>
              Proveedor
              <input style={inputStyle} value={form.proveedor} onChange={update('proveedor')} maxLength={100} />
            </label>
          )}

          <label style={labelStyle}>
            Profesional
            <input style={inputStyle} value={form.profesional} onChange={update('profesional')} maxLength={100} />
          </label>

          <div style={{ display: 'flex', gap: '10px' }}>
            <label style={{ ...labelStyle, flex: 1 }}>
              Fecha de prestación
              <input style={inputStyle} type="date" value={form.fechaPrestacion} onChange={update('fechaPrestacion')} />
            </label>
            {esPendiente && (
              <label style={{ ...labelStyle, flex: 1 }}>
                Fecha de vencimiento
                <input style={inputStyle} type="date" value={form.fechaVencimiento} onChange={update('fechaVencimiento')} />
              </label>
            )}
          </div>

          {mensajeError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 12px', borderRadius: '8px', fontSize: '13px' }}>
              {mensajeError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button type="button" onClick={onCerrar} style={btnSecStyle}>Cancelar</button>
            <button type="submit" disabled={guardando} style={btnPrimStyle}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Estilos (consistentes con el resto del dashboard) ──────────────────────

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 100, padding: '20px',
}

const modalStyle = {
  background: '#fff', borderRadius: '16px', padding: '24px',
  width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
}

const labelStyle = {
  display: 'flex', flexDirection: 'column', gap: '6px',
  fontSize: '13px', fontWeight: 600, color: '#374151',
}

const inputStyle = {
  padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px',
  fontSize: '14px', outline: 'none', width: '100%', boxSizing: 'border-box',
}

const btnSecStyle = {
  padding: '9px 18px', borderRadius: '8px', border: '1px solid #e5e7eb',
  background: '#fff', color: '#374151', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
}

const btnPrimStyle = {
  padding: '9px 18px', borderRadius: '8px', border: 'none',
  background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
  color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
}
