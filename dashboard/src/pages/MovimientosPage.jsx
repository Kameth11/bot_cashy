import { useState, useEffect, useMemo, useCallback } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { api } from '../services/api'
import { useMovimientosEvents } from '../hooks/useMovimientosEvents'
import { useApp } from '../contexts/AppContext'
import DatePickerButton from '../components/DatePickerButton'
import { ordenarPorFechaDesc } from '../utils/movimientos'

// ── Helpers ────────────────────────────────────────────────

function formatFecha(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return format(d, 'dd/MM/yy', { locale: es })
}

// Para valores de <input type="date"> ("yyyy-mm-dd"), evita el corrimiento
// de un día que produce `new Date(value)` al interpretarlo como UTC.
function formatFechaInput(value) {
  const [y, m, d] = value.split('-').map(Number)
  return format(new Date(y, m - 1, d), 'dd/MM/yy', { locale: es })
}

const MONEDA_KEY = { Pesos: 'ARS', Dólares: 'USD', Euros: 'EUR' }

function CurrencyBadge({ moneda }) {
  const k = MONEDA_KEY[moneda] || 'ARS'
  return <span className={`badge-cur ${k}`}>{k}</span>
}

function StatusBadge({ estado }) {
  return <span className={`badge-status ${(estado || '').toLowerCase()}`}>{estado || '—'}</span>
}

// Muestra "(cobrado DD/MM/YY)" solo cuando el movimiento se cobró en una
// fecha distinta a la original (transición real Pendiente -> Cobrado), no en
// movimientos creados directamente como Cobrado.
function FechaCobroNote({ mov }) {
  if (mov.estado !== 'Cobrado' || !mov.fechaCobro || mov.fechaCobro === mov.fecha) return null
  return <span style={{ fontSize: 11, color: 'var(--text-3)' }}>(cobrado {formatFecha(mov.fechaCobro)})</span>
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

// ── Main ───────────────────────────────────────────────────

export default function MovimientosPage() {
  const { reloadSignal } = useApp()

  const [movimientos, setMovimientos] = useState([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [reload,      setReload]      = useState(0)

  const [q,      setQ]      = useState('')
  const [tipo,   setTipo]   = useState('todos')
  const [moneda, setMoneda] = useState('todas')
  const [fecha,  setFecha]  = useState('') // yyyy-mm-dd

  const [editando,      setEditando]      = useState(null)
  const [guardando,     setGuardando]     = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [borrando,      setBorrando]      = useState(false)
  const [modalError,    setModalError]    = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data } = await api.get('/api/movimientos')
        if (active) setMovimientos(Array.isArray(data?.movimientos) ? data.movimientos : [])
      } catch {
        if (active) setError('No se pudieron cargar los movimientos')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [reload, reloadSignal])

  useMovimientosEvents(useCallback(() => setReload(r => r + 1), []))

  const filtered = useMemo(() => {
    let r = movimientos
    if (tipo !== 'todos') r = r.filter(m => m.tipo?.toLowerCase() === tipo)
    if (moneda !== 'todas') {
      const map = { ARS: 'Pesos', USD: 'Dólares', EUR: 'Euros' }
      r = r.filter(m => m.moneda === map[moneda])
    }
    if (q.trim()) {
      const qn = q.trim().toLowerCase()
      r = r.filter(m =>
        (m.descripcion || '').toLowerCase().includes(qn) ||
        (m.paciente    || '').toLowerCase().includes(qn) ||
        (m.profesional || '').toLowerCase().includes(qn) ||
        (m.categoria   || '').toLowerCase().includes(qn)
      )
    }
    if (fecha) {
      r = r.filter(m => {
        // m.fecha viene como "DD/MM/YYYY" (no lo puede parsear new Date())
        const [d, mo, y] = String(m.fecha || '').split('/')
        if (!d || !mo || !y) return false
        const ymd = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
        return ymd === fecha
      })
    }
    return ordenarPorFechaDesc(r)
  }, [movimientos, tipo, moneda, q, fecha])

  const handleGuardar = useCallback(async (idUnico, updates) => {
    setModalError(null)
    if (!idUnico) { setModalError('Sin ID único — editalo en el Sheet.'); return }
    setGuardando(true)
    try {
      await api.put(`/api/movimientos/${idUnico}`, updates)
      setEditando(null)
      setReload(r => r + 1)
    } catch (err) {
      setModalError(err?.response?.data?.error || 'Error al guardar')
    } finally { setGuardando(false) }
  }, [])

  const handleBorrar = useCallback(async (idUnico, mov) => {
    setModalError(null)
    setBorrando(true)
    try {
      if (idUnico) await api.delete(`/api/movimientos/${idUnico}`)
      else await api.delete('/api/movimientos-by-key', { data: { descripcion: mov.descripcion, monto: mov.monto, fecha: mov.fecha } })
      setConfirmDelete(null)
      setReload(r => r + 1)
    } catch (err) {
      setModalError(err?.response?.data?.error || 'Error al eliminar')
    } finally { setBorrando(false) }
  }, [])

  const hasFilters = tipo !== 'todos' || moneda !== 'todas' || q.trim() || fecha

  return (
    <div className="page">
      {editando && (
        <EditModal
          mov={editando} guardando={guardando} error={modalError}
          onGuardar={handleGuardar}
          onCerrar={() => { setEditando(null); setModalError(null) }}
        />
      )}
      {confirmDelete && (
        <ConfirmDeleteModal
          mov={confirmDelete} borrando={borrando} error={modalError}
          onConfirmar={() => handleBorrar(confirmDelete.idUnico, confirmDelete)}
          onCancelar={() => { setConfirmDelete(null); setModalError(null) }}
        />
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Movimientos</h1>
          <p className="page-subtitle">
            {loading ? 'Cargando…' : `${filtered.length} registro${filtered.length !== 1 ? 's' : ''} encontrado${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Filter bar */}
      <div className="filter-bar">
        <input
          className="filter-input"
          placeholder="Buscar descripción o paciente…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <div className="filter-divider" />
        <div className="filter-chips">
          {[['todos','Todos'],['ingreso','Ingresos'],['egreso','Egresos']].map(([v,l]) => (
            <button key={v} className={`chip${tipo === v ? ' active' : ''}`} onClick={() => setTipo(v)}>{l}</button>
          ))}
        </div>
        <div className="filter-divider" />
        <div className="filter-chips">
          {[['todas','Todas'],['ARS','ARS'],['USD','USD'],['EUR','EUR']].map(([v,l]) => (
            <button key={v} className={`chip${moneda === v ? ' active' : ''}`} onClick={() => setMoneda(v)}>{l}</button>
          ))}
        </div>
        <div className="filter-divider" />
        <div className="filter-chips" style={{ alignItems: 'center' }}>
          <DatePickerButton value={fecha} onChange={setFecha} title="Filtrar por fecha" className="chip" />
          {fecha && (
            <button className="chip active" onClick={() => setFecha('')}>
              {formatFechaInput(fecha)} ×
            </button>
          )}
        </div>
        {hasFilters && (
          <button className="clear-btn" onClick={() => { setQ(''); setTipo('todos'); setMoneda('todas'); setFecha('') }}>
            Limpiar filtros ×
          </button>
        )}
      </div>

      <div className="card-surface">
        {!filtered.length && !loading && (
          <div className="empty-state">
            {movimientos.length > 0 ? 'Ningún movimiento coincide con los filtros' : 'Sin movimientos'}
          </div>
        )}

        {filtered.length > 0 && (
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
                {filtered.map((mov, i) => {
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
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          <StatusBadge estado={mov.estado} />
                          <FechaCobroNote mov={mov} />
                        </div>
                      </td>
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
              {filtered.map((mov, i) => (
                <div key={mov.idUnico ?? i} className="mov-card-mobile">
                  <div className="mov-card-top">
                    <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 700 }}>{formatFecha(mov.fecha)}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      <StatusBadge estado={mov.estado} />
                      <FechaCobroNote mov={mov} />
                    </div>
                  </div>
                  <div className="mv-desc">
                    <span className="mv-dot" style={{ background: mov.tipo?.toLowerCase() === 'egreso' ? 'var(--red)' : 'var(--green)' }} />
                    <span className="mov-card-desc">{mov.descripcion}</span>
                  </div>
                  {(mov.paciente || mov.profesional) && <div className="mov-card-sub">{mov.paciente || mov.profesional}</div>}
                  <div className="mov-card-bottom">
                    <MontoCell mov={mov} />
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button className="action-btn" onClick={() => { setModalError(null); setEditando(mov) }}>✏️</button>
                      <button className="action-btn" onClick={() => { setModalError(null); setConfirmDelete(mov) }}>🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
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
    const n = parseFloat(monto)
    if (!isNaN(n) && n !== Math.abs(Number(mov.monto || 0))) updates.monto = n
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
          <div><label className="form-label">Descripción</label><input className="form-input" value={descripcion} onChange={e => setDescripcion(e.target.value)} required /></div>
          <div><label className="form-label">Monto</label><input className="form-input" type="number" step="0.01" min="0" value={monto} onChange={e => setMonto(e.target.value)} required /></div>
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

function ConfirmDeleteModal({ mov, borrando, error, onConfirmar, onCancelar }) {
  return (
    <div className="overlay" onClick={onCancelar}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title" style={{ fontSize: 16 }}>¿Eliminar movimiento?</h2>
        <p style={{ fontSize: 14, marginBottom: 6 }}>{mov.descripcion}</p>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>{mov.estado}</p>
        {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancelar}>Cancelar</button>
          <button className="btn-danger" onClick={onConfirmar} disabled={borrando}>{borrando ? 'Eliminando…' : 'Eliminar'}</button>
        </div>
      </div>
    </div>
  )
}
