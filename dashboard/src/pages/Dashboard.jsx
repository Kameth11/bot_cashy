import { useState, useEffect, useMemo, useCallback } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { api } from '../services/api'
import MetricCard from '../components/MetricCard'
import PlusButton from '../components/PlusButton'
import CotizacionWidget from '../components/CotizacionWidget'

function Dashboard() {
  const [filtro, setFiltro] = useState('mes')
  const [movimientos, setMovimientos] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)

  // Modal de edición
  const [editando, setEditando] = useState(null)       // mov object | null
  const [guardando, setGuardando] = useState(false)

  // Confirmación de borrado
  const [confirmDelete, setConfirmDelete] = useState(null) // mov object | null
  const [borrando, setBorrando] = useState(false)

  const range = useMemo(() => {
    const now = new Date()
    if (filtro === 'hoy') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      return { desde: start, hasta: now.toISOString() }
    }
    if (filtro === 'semana') {
      const start = new Date(now)
      start.setDate(now.getDate() - now.getDay())
      start.setHours(0, 0, 0, 0)
      return { desde: start.toISOString(), hasta: now.toISOString() }
    }
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    return { desde: start, hasta: now.toISOString() }
  }, [filtro])

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data } = await api.get('/api/movimientos', {
          params: { desde: range.desde, hasta: range.hasta }
        })
        if (!active) return
        setMovimientos(Array.isArray(data?.movimientos) ? data.movimientos : [])
      } catch (err) {
        if (!active) return
        console.error('Dashboard error', err)
        setError('No se pudieron cargar los movimientos')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [range, reload])

  const metricas = useMemo(() => {
    const cobrados = movimientos.filter(m =>
      m.tipo?.toLowerCase() === 'ingreso' && m.estado?.toLowerCase() === 'cobrado'
    )
    const egresosArr = movimientos.filter(m => m.tipo?.toLowerCase() === 'egreso')
    const pendientes = movimientos.filter(m => m.estado?.toLowerCase() === 'pendiente').length

    const sumPesos = (arr) =>
      arr.reduce((acc, m) => acc + Math.abs(Number(m.montoPesos || m.monto || 0)), 0)

    const buildBreakdown = (arr, sign = 1) => {
      const result = {}
      for (const m of arr) {
        const moneda = m.moneda || 'Pesos'
        if (!result[moneda]) result[moneda] = { monto: 0, montoPesos: 0 }
        result[moneda].monto      += sign * Math.abs(Number(m.monto || 0))
        result[moneda].montoPesos += sign * Math.abs(Number(m.montoPesos || m.monto || 0))
      }
      return result
    }

    const bIng = buildBreakdown(cobrados, 1)
    const bEgr = buildBreakdown(egresosArr, -1)
    const bNeto = { ...bIng }
    for (const [moneda, vals] of Object.entries(bEgr)) {
      if (!bNeto[moneda]) bNeto[moneda] = { monto: 0, montoPesos: 0 }
      bNeto[moneda].monto      += vals.monto
      bNeto[moneda].montoPesos += vals.montoPesos
    }

    const ingresos = sumPesos(cobrados)
    const egresos  = sumPesos(egresosArr)

    return {
      ingresos, egresos, pendientes,
      neto: ingresos - egresos,
      bIngresos: bIng,
      bEgresos: buildBreakdown(egresosArr, 1),
      bNeto,
    }
  }, [movimientos])

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleGuardarEdicion = useCallback(async (idUnico, updates) => {
    setGuardando(true)
    try {
      await api.put(`/api/movimientos/${idUnico}`, updates)
      setEditando(null)
      setReload(r => r + 1)
    } catch (err) {
      alert(err?.response?.data?.error || 'Error al guardar cambios')
    } finally {
      setGuardando(false)
    }
  }, [])

  const handleConfirmarBorrado = useCallback(async (idUnico) => {
    setBorrando(true)
    try {
      await api.delete(`/api/movimientos/${idUnico}`)
      setConfirmDelete(null)
      setReload(r => r + 1)
    } catch (err) {
      alert(err?.response?.data?.error || 'Error al eliminar')
    } finally {
      setBorrando(false)
    }
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6' }}>
      {/* Modales */}
      {editando && (
        <EditModal
          mov={editando}
          guardando={guardando}
          onGuardar={handleGuardarEdicion}
          onCerrar={() => setEditando(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDeleteModal
          mov={confirmDelete}
          borrando={borrando}
          onConfirmar={() => handleConfirmarBorrado(confirmDelete.idUnico)}
          onCancelar={() => setConfirmDelete(null)}
        />
      )}

      <header style={{
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 10
      }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1f2937' }}>Dashboard</h1>
          <p style={{ color: '#64748b', fontSize: '13px' }}>
            {filtro === 'hoy' ? 'Hoy' : filtro === 'semana' ? 'Esta semana' : 'Este mes'}
          </p>
        </div>
        <PlusButton onClick={() => alert('Próximamente: nuevo movimiento desde el panel')} />
      </header>

      <main style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>
        {/* Filtros */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {['hoy', 'semana', 'mes'].map((p) => (
            <button
              key={p}
              onClick={() => setFiltro(p)}
              style={{
                padding: '8px 18px',
                borderRadius: '10px',
                border: '1px solid #e5e7eb',
                background: filtro === p ? 'linear-gradient(135deg, #0ea5e9, #6366f1)' : '#fff',
                color: filtro === p ? '#fff' : '#374151',
                fontWeight: 600,
                fontSize: '14px',
                transition: 'background 0.15s',
              }}
            >
              {p === 'hoy' ? 'Hoy' : p === 'semana' ? 'Semana' : 'Mes'}
            </button>
          ))}
        </div>

        {error && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca',
            color: '#dc2626', padding: '12px', borderRadius: '10px',
            marginBottom: '20px', fontSize: '14px'
          }}>
            {error}
          </div>
        )}

        <CotizacionWidget />

        {/* Métricas */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px', marginBottom: '28px'
        }}>
          <MetricCard label="Ingresos"   value={`$${metricas.ingresos.toLocaleString('es-AR')}`}   variant="ingresos"   breakdown={metricas.bIngresos} />
          <MetricCard label="Egresos"    value={`$${metricas.egresos.toLocaleString('es-AR')}`}    variant="egresos"    breakdown={metricas.bEgresos} />
          <MetricCard label="Pendientes" value={String(metricas.pendientes)}                        variant="pendientes" />
          <MetricCard
            label="Neto"
            value={`${metricas.neto < 0 ? '-' : ''}$${Math.abs(metricas.neto).toLocaleString('es-AR')}`}
            variant="neto"
            breakdown={metricas.bNeto}
          />
        </div>

        {/* Tabla */}
        <div style={{ background: '#fff', borderRadius: '14px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1f2937' }}>
              Movimientos{' '}
              {loading && <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '14px' }}>(cargando...)</span>}
            </h2>
          </div>

          {!movimientos.length && !loading && (
            <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
              Sin movimientos en este periodo
            </div>
          )}

          {movimientos.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={thStyle}>Fecha</th>
                    <th style={thStyle}>Descripción</th>
                    <th style={thStyle}>Profesional</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Monto</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Estado</th>
                    <th style={{ ...thStyle, textAlign: 'center', width: '80px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((mov, index) => (
                    <tr
                      key={mov.idUnico ?? mov.id ?? index}
                      style={{ borderBottom: '1px solid #f3f4f6' }}
                      className="mov-row"
                    >
                      <td style={tdStyle}>{formatFecha(mov.fecha)}</td>
                      <td style={tdStyle}>{mov.descripcion}</td>
                      <td style={{ ...tdStyle, color: '#64748b' }}>{mov.profesional || '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <MontoCell mov={mov} />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <EstadoBadge estado={mov.estado} />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center', padding: '10px 8px' }}>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          <ActionBtn
                            title="Editar"
                            onClick={() => setEditando(mov)}
                            color="#6366f1"
                          >
                            ✏️
                          </ActionBtn>
                          <ActionBtn
                            title="Eliminar"
                            onClick={() => setConfirmDelete(mov)}
                            color="#ef4444"
                          >
                            🗑️
                          </ActionBtn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

// ── Componentes auxiliares ──────────────────────────────────────────────────

function ActionBtn({ children, onClick, title, color }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '4px 6px',
        borderRadius: '6px',
        fontSize: '14px',
        opacity: 0.7,
        transition: 'opacity 0.15s, background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = '#f1f5f9' }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.background = 'none' }}
    >
      {children}
    </button>
  )
}

function EditModal({ mov, guardando, onGuardar, onCerrar }) {
  const [descripcion, setDescripcion] = useState(mov.descripcion || '')
  const [monto, setMonto]             = useState(String(Math.abs(Number(mov.monto || 0))))
  const [estado, setEstado]           = useState(mov.estado || 'Cobrado')
  const [metodoPago, setMetodoPago]   = useState(mov.metodoPago || '')

  const handleSubmit = (e) => {
    e.preventDefault()
    const updates = {}
    if (descripcion !== mov.descripcion) updates.descripcion = descripcion
    const montoNum = parseFloat(monto)
    if (!isNaN(montoNum) && montoNum !== Math.abs(Number(mov.monto || 0))) updates.monto = montoNum
    if (estado !== mov.estado) updates.estado = estado
    if (metodoPago !== (mov.metodoPago || '')) updates.metodoPago = metodoPago
    if (Object.keys(updates).length === 0) return onCerrar()
    onGuardar(mov.idUnico, updates)
  }

  return (
    <div style={overlayStyle} onClick={onCerrar}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Editar movimiento</h3>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label style={labelStyle}>
            Descripción
            <input style={inputStyle} value={descripcion} onChange={e => setDescripcion(e.target.value)} required />
          </label>
          <label style={labelStyle}>
            Monto
            <input style={inputStyle} type="number" step="0.01" min="0" value={monto} onChange={e => setMonto(e.target.value)} required />
          </label>
          <label style={labelStyle}>
            Estado
            <select style={inputStyle} value={estado} onChange={e => setEstado(e.target.value)}>
              <option value="Cobrado">Cobrado</option>
              <option value="Pendiente">Pendiente</option>
            </select>
          </label>
          <label style={labelStyle}>
            Método de pago
            <select style={inputStyle} value={metodoPago} onChange={e => setMetodoPago(e.target.value)}>
              <option value="">Sin especificar</option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
            </select>
          </label>
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

function ConfirmDeleteModal({ mov, borrando, onConfirmar, onCancelar }) {
  return (
    <div style={overlayStyle} onClick={onCancelar}>
      <div style={{ ...modalStyle, maxWidth: '380px' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>¿Eliminar movimiento?</h3>
        <p style={{ color: '#374151', fontSize: '14px', marginBottom: '6px' }}>{mov.descripcion}</p>
        <p style={{ color: '#64748b', fontSize: '13px', marginBottom: '20px' }}>
          {formatFecha(mov.fecha)} · {mov.estado}
        </p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onCancelar} style={btnSecStyle}>Cancelar</button>
          <button onClick={onConfirmar} disabled={borrando} style={{ ...btnPrimStyle, background: '#ef4444' }}>
            {borrando ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sub-componentes de tabla ───────────────────────────────────────────────

const MONEDA_CONFIG = {
  'Dólares': { simbolo: 'U$S', badge: 'USD', badgeBg: '#dbeafe', badgeColor: '#1d4ed8' },
  'Euros':   { simbolo: '€',   badge: 'EUR', badgeBg: '#fef9c3', badgeColor: '#92400e' },
}

function MontoCell({ mov }) {
  const esEgreso = mov.tipo?.toLowerCase() === 'egreso'
  const colorMonto = esEgreso ? '#ef4444' : '#10b981'
  const moneda = mov.moneda || 'Pesos'
  const cfg = MONEDA_CONFIG[moneda]
  const abs = Math.abs(Number(mov.monto || 0))
  const absPesos = Math.abs(Number(mov.montoPesos || 0))
  const montoStr = cfg
    ? `${cfg.simbolo} ${abs.toLocaleString('es-AR')}`
    : `$${abs.toLocaleString('es-AR')}`

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {cfg && (
          <span style={{
            display: 'inline-block', padding: '2px 6px', borderRadius: '6px',
            fontSize: '10px', fontWeight: 700, background: cfg.badgeBg, color: cfg.badgeColor,
            letterSpacing: '0.03em',
          }}>
            {cfg.badge}
          </span>
        )}
        <span style={{ fontWeight: 700, color: colorMonto }}>
          {esEgreso ? '-' : ''}{montoStr}
        </span>
      </div>
      {cfg && absPesos > 0 && (
        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
          ≈ ${absPesos.toLocaleString('es-AR')} pesos
        </span>
      )}
    </div>
  )
}

function EstadoBadge({ estado }) {
  const cobrado = estado?.toLowerCase() === 'cobrado'
  return (
    <span style={{
      display: 'inline-block', padding: '4px 10px', borderRadius: '999px',
      fontSize: '12px', fontWeight: 700,
      background: cobrado ? '#dcfce7' : '#fef3c7',
      color: cobrado ? '#166534' : '#b45309',
    }}>
      {estado}
    </span>
  )
}

function formatFecha(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return format(d, 'dd/MM/yyyy', { locale: es })
}

// ── Estilos ────────────────────────────────────────────────────────────────

const thStyle = {
  padding: '12px 16px', textAlign: 'left', fontSize: '11px',
  fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em',
}

const tdStyle = {
  padding: '14px 16px', fontSize: '14px', color: '#1f2937',
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 100, padding: '20px',
}

const modalStyle = {
  background: '#fff', borderRadius: '16px', padding: '24px',
  width: '100%', maxWidth: '460px',
  boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
}

const labelStyle = {
  display: 'flex', flexDirection: 'column', gap: '6px',
  fontSize: '13px', fontWeight: 600, color: '#374151',
}

const inputStyle = {
  padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px',
  fontSize: '14px', outline: 'none',
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

export default Dashboard
