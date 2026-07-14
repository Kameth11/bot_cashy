import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { api } from '../services/api'
import MetricCard from '../components/MetricCard'
import { useMovimientosEvents } from '../hooks/useMovimientosEvents'
import { useApp } from '../contexts/AppContext'
import { ordenarPorFechaDesc } from '../utils/movimientos'

// ── Helpers ────────────────────────────────────────────────

function formatFecha(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return format(d, 'dd/MM', { locale: es })
}

const MONEDA_KEY = { Pesos: 'ARS', Dólares: 'USD', Euros: 'EUR' }

function currencyKey(moneda) { return MONEDA_KEY[moneda] || 'ARS' }

// ── Sub-components ─────────────────────────────────────────

function CurrencyBadge({ moneda }) {
  const k = currencyKey(moneda)
  return <span className={`badge-cur ${k}`}>{k}</span>
}

function StatusBadge({ estado }) {
  const key = (estado || '').toLowerCase()
  return <span className={`badge-status ${key}`}>{estado || '—'}</span>
}

function MontoCell({ mov }) {
  const esEgreso = mov.tipo?.toLowerCase() === 'egreso'
  const moneda   = mov.moneda || 'Pesos'
  const abs      = Math.abs(Number(mov.monto || 0))
  const absPesos = Math.abs(Number(mov.montoPesos || 0))
  const cfg      = { Dólares: 'U$S', Euros: '€' }
  const sim      = cfg[moneda]
  const montoStr = sim ? `${sim} ${abs.toLocaleString('es-AR')}` : `$${abs.toLocaleString('es-AR')}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <span className={`mv-monto ${esEgreso ? 'egreso' : 'ingreso'}`}>
        {esEgreso ? '−' : '+'}{montoStr}
      </span>
      {sim && absPesos > 0 && (
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>≈ ${absPesos.toLocaleString('es-AR')}</span>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate()
  const { reloadSignal } = useApp()

  const [period,      setPeriod]      = useState('este-mes')
  const [movimientos, setMovimientos] = useState([])
  const [pendientesTotales, setPendientesTotales] = useState([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [reload,      setReload]      = useState(0)

  // Edit / delete state
  const [editando,       setEditando]       = useState(null)
  const [guardando,      setGuardando]      = useState(false)
  const [confirmDelete,  setConfirmDelete]  = useState(null)
  const [borrando,       setBorrando]       = useState(false)
  const [modalError,     setModalError]     = useState(null)

  const range = useMemo(() => {
    const now = new Date()
    if (period === 'este-mes') {
      return {
        desde: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        hasta: now.toISOString(),
      }
    }
    if (period === 'mes-anterior') {
      return {
        desde: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
        hasta: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString(),
      }
    }
    // 3-meses
    const start = new Date(now)
    start.setMonth(now.getMonth() - 3)
    start.setHours(0, 0, 0, 0)
    return { desde: start.toISOString(), hasta: now.toISOString() }
  }, [period])

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [{ data }, { data: dataPend }] = await Promise.all([
          api.get('/api/movimientos', { params: { desde: range.desde, hasta: range.hasta } }),
          api.get('/api/movimientos', { params: { estado: 'Pendiente' } }),
        ])
        if (active) {
          setMovimientos(Array.isArray(data?.movimientos) ? data.movimientos : [])
          setPendientesTotales(Array.isArray(dataPend?.movimientos) ? dataPend.movimientos : [])
        }
      } catch (err) {
        if (active) setError('No se pudieron cargar los movimientos')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [range, reload, reloadSignal])

  useMovimientosEvents(useCallback(() => setReload(r => r + 1), []))

  const metricas = useMemo(() => {
    const cobrados      = movimientos.filter(m => m.tipo?.toLowerCase() === 'ingreso' && m.estado?.toLowerCase() === 'cobrado')
    const egresosArr    = movimientos.filter(m => m.tipo?.toLowerCase() === 'egreso')
    // Pendientes: todos los impagos sin importar el período seleccionado
    const pendientesArr = pendientesTotales
    const pendientes    = pendientesArr.length

    const sumPesos = arr => arr.reduce((acc, m) => acc + Math.abs(Number(m.montoPesos || m.monto || 0)), 0)

    const buildBreakdown = (arr, sign = 1) => {
      const r = {}
      for (const m of arr) {
        const moneda = m.moneda || 'Pesos'
        if (!r[moneda]) r[moneda] = { monto: 0, montoPesos: 0 }
        r[moneda].monto      += sign * Math.abs(Number(m.monto || 0))
        r[moneda].montoPesos += sign * Math.abs(Number(m.montoPesos || m.monto || 0))
      }
      return r
    }

    const ingresos = sumPesos(cobrados)
    const egresos  = sumPesos(egresosArr)
    const neto     = ingresos - egresos

    return {
      ingresos, egresos, pendientes, pendientesArr, neto,
      bIngresos: buildBreakdown(cobrados, 1),
      bEgresos:  buildBreakdown(egresosArr, 1),
      bNeto: (() => {
        const b = { ...buildBreakdown(cobrados, 1) }
        for (const [k, v] of Object.entries(buildBreakdown(egresosArr, -1))) {
          if (!b[k]) b[k] = { monto: 0, montoPesos: 0 }
          b[k].monto      += v.monto
          b[k].montoPesos += v.montoPesos
        }
        return b
      })(),
    }
  }, [movimientos, pendientesTotales])

  // ── Edit / delete handlers ────────────────────────────────

  const handleGuardarEdicion = useCallback(async (idUnico, updates) => {
    setModalError(null)
    if (!idUnico) { setModalError('Sin ID único — editalo en el Google Sheet.'); return }
    setGuardando(true)
    try {
      await api.put(`/api/movimientos/${idUnico}`, updates)
      setEditando(null)
      setReload(r => r + 1)
    } catch (err) {
      setModalError(err?.response?.data?.error || err?.message || 'Error al guardar')
    } finally { setGuardando(false) }
  }, [])

  const handleBorrar = useCallback(async (idUnico, mov) => {
    setModalError(null)
    setBorrando(true)
    try {
      if (idUnico) {
        await api.delete(`/api/movimientos/${idUnico}`)
      } else {
        await api.delete('/api/movimientos-by-key', {
          data: { descripcion: mov.descripcion, monto: mov.monto, fecha: mov.fecha }
        })
      }
      setConfirmDelete(null)
      setReload(r => r + 1)
    } catch (err) {
      setModalError(err?.response?.data?.error || err?.message || 'Error al eliminar')
    } finally { setBorrando(false) }
  }, [])

  // Preview: last 6 movements
  const preview = ordenarPorFechaDesc(movimientos).slice(0, 6)

  const periodLabel = { 'este-mes': 'Este mes', 'mes-anterior': 'Mes anterior', '3-meses': 'Últimos 3 meses' }

  return (
    <div className="page">
      {/* Modales */}
      {editando && (
        <EditModal
          mov={editando}
          guardando={guardando}
          error={modalError}
          onGuardar={handleGuardarEdicion}
          onCerrar={() => { setEditando(null); setModalError(null) }}
        />
      )}
      {confirmDelete && (
        <ConfirmDeleteModal
          mov={confirmDelete}
          borrando={borrando}
          error={modalError}
          onConfirmar={() => handleBorrar(confirmDelete.idUnico, confirmDelete)}
          onCancelar={() => { setConfirmDelete(null); setModalError(null) }}
        />
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">{periodLabel[period]} · Consultorio Odontológico</p>
        </div>
        <div className="period-sel">
          {[['este-mes','Este mes'],['mes-anterior','Mes anterior'],['3-meses','3 meses']].map(([v,l]) => (
            <button key={v} className={`period-btn${period === v ? ' active' : ''}`} onClick={() => setPeriod(v)}>{l}</button>
          ))}
        </div>
      </div>

      {error && (
        <div className="error-box" style={{ marginBottom: 20 }}>{error}</div>
      )}

      {/* Metric cards */}
      <div className="metric-grid">
        <MetricCard
          label="Ingresos"
          value={`$${metricas.ingresos.toLocaleString('es-AR')}`}
          subtitle={`${movimientos.filter(m => m.tipo?.toLowerCase() === 'ingreso' && m.estado?.toLowerCase() === 'cobrado').length} cobrados`}
          variant="ingresos"
          breakdown={metricas.bIngresos}
        />
        <MetricCard
          label="Egresos"
          value={`$${metricas.egresos.toLocaleString('es-AR')}`}
          subtitle={`${movimientos.filter(m => m.tipo?.toLowerCase() === 'egreso').length} registrados`}
          variant="egresos"
          breakdown={metricas.bEgresos}
        />
        <MetricCard
          label="Pendientes"
          value={String(metricas.pendientes)}
          subtitle={metricas.pendientes === 1 ? 'total acumulado' : `${metricas.pendientes} total acumulado`}
          variant="pendientes"
          items={metricas.pendientesArr}
        />
        <MetricCard
          label="Neto del período"
          value={`${metricas.neto < 0 ? '-' : ''}$${Math.abs(metricas.neto).toLocaleString('es-AR')}`}
          subtitle={metricas.neto >= 0 ? 'Resultado positivo ▲' : 'Resultado negativo ▼'}
          variant={metricas.neto >= 0 ? 'neto-pos' : 'neto-neg'}
          breakdown={metricas.bNeto}
        />
      </div>

      {/* Movement table */}
      <div className="card-surface">
        <div className="card-header">
          <b>Últimos movimientos {loading && <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-3)' }}>(cargando…)</span>}</b>
          <button className="card-header-link" onClick={() => navigate('/movimientos')}>Ver todos →</button>
        </div>

        {!preview.length && !loading && (
          <div className="empty-state">Sin movimientos en este período</div>
        )}

        {preview.length > 0 && (
          <>
            <table className="mv-table">
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th>Paciente / Proveedor</th>
                  <th>Fecha</th>
                  <th>Moneda</th>
                  <th className="right">Monto</th>
                  <th>Estado</th>
                  <th style={{ width: 64 }} />
                </tr>
              </thead>
              <tbody>
                {preview.map((mov, i) => {
                  const esEgreso = mov.tipo?.toLowerCase() === 'egreso'
                  return (
                    <tr key={mov.idUnico ?? mov.id ?? i}>
                      <td>
                        <div className="mv-desc">
                          <span className="mv-dot" style={{ background: esEgreso ? 'var(--red)' : 'var(--green)' }} />
                          {mov.descripcion}
                        </div>
                      </td>
                      <td className="mv-patient">{mov.paciente || mov.proveedor || mov.profesional || '—'}</td>
                      <td className="mv-fecha">{formatFecha(mov.fecha)}</td>
                      <td><CurrencyBadge moneda={mov.moneda} /></td>
                      <td className="right"><MontoCell mov={mov} /></td>
                      <td><StatusBadge estado={mov.estado} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                          <button className="action-btn" title="Editar" onClick={() => { setModalError(null); setEditando(mov) }}>✏️</button>
                          <button className="action-btn" title="Eliminar" onClick={() => { setModalError(null); setConfirmDelete(mov) }}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="mov-cards-mobile">
              {preview.map((mov, i) => {
                const esEgreso = mov.tipo?.toLowerCase() === 'egreso'
                return (
                  <div key={mov.idUnico ?? i} className="mov-card-mobile">
                    <div className="mov-card-top">
                      <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 700 }}>{formatFecha(mov.fecha)}</span>
                      <StatusBadge estado={mov.estado} />
                    </div>
                    <div className="mov-card-desc">{mov.descripcion}</div>
                    {(mov.paciente || mov.profesional) && (
                      <div className="mov-card-sub">{mov.paciente || mov.profesional}</div>
                    )}
                    <div className="mov-card-bottom">
                      <MontoCell mov={mov} />
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button className="action-btn" onClick={() => { setModalError(null); setEditando(mov) }}>✏️</button>
                        <button className="action-btn" onClick={() => { setModalError(null); setConfirmDelete(mov) }}>🗑️</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Edit modal ─────────────────────────────────────────────

function EditModal({ mov, guardando, error, onGuardar, onCerrar }) {
  const [descripcion, setDescripcion] = useState(mov.descripcion || '')
  const [monto,       setMonto]       = useState(String(Math.abs(Number(mov.monto || 0))))
  const [estado,      setEstado]      = useState(mov.estado || 'Cobrado')
  const [metodoPago,  setMetodoPago]  = useState(mov.metodoPago || '')

  const handleSubmit = (e) => {
    e.preventDefault()
    const updates = {}
    if (descripcion !== mov.descripcion) updates.descripcion = descripcion
    const montoNum = parseFloat(monto)
    if (!isNaN(montoNum) && montoNum !== Math.abs(Number(mov.monto || 0))) updates.monto = montoNum
    if (estado !== mov.estado) updates.estado = estado
    if (metodoPago !== (mov.metodoPago || '')) updates.metodoPago = metodoPago
    if (!Object.keys(updates).length) return onCerrar()
    onGuardar(mov.idUnico, updates)
  }

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title" style={{ fontSize: 16 }}>Editar movimiento</h2>
        <form onSubmit={handleSubmit} className="modal-form">
          <div>
            <label className="form-label">Descripción</label>
            <input className="form-input" value={descripcion} onChange={e => setDescripcion(e.target.value)} required />
          </div>
          <div>
            <label className="form-label">Monto</label>
            <input className="form-input" type="number" step="0.01" min="0" value={monto} onChange={e => setMonto(e.target.value)} required />
          </div>
          <div>
            <label className="form-label">Estado</label>
            <select className="form-input" value={estado} onChange={e => setEstado(e.target.value)}>
              <option value="Cobrado">Cobrado</option>
              <option value="Pendiente">Pendiente</option>
              <option value="Pagado">Pagado</option>
            </select>
          </div>
          <div>
            <label className="form-label">Método de pago</label>
            <select className="form-input" value={metodoPago} onChange={e => setMetodoPago(e.target.value)}>
              <option value="">Sin especificar</option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
            </select>
          </div>
          {error && <div className="error-box">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Confirm delete modal ───────────────────────────────────

function ConfirmDeleteModal({ mov, borrando, error, onConfirmar, onCancelar }) {
  return (
    <div className="overlay" onClick={onCancelar}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title" style={{ fontSize: 16 }}>¿Eliminar movimiento?</h2>
        <p style={{ color: 'var(--text)', fontSize: 14, marginBottom: 6 }}>{mov.descripcion}</p>
        <p style={{ color: 'var(--text-3)', fontSize: 13, marginBottom: 16 }}>
          {formatFecha(mov.fecha)} · {mov.estado}
        </p>
        {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancelar}>Cancelar</button>
          <button className="btn-danger" onClick={onConfirmar} disabled={borrando}>
            {borrando ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}
