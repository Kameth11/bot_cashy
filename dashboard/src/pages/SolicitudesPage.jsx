import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'

function formatFecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function StatusBadge({ status }) {
  const cfg = {
    pending:  { label: 'Pendiente', cls: 'pendiente' },
    approved: { label: 'Aprobada',  cls: 'cobrado'   },
    rejected: { label: 'Rechazada', cls: 'egreso'    },
  }
  const { label, cls } = cfg[status] || { label: status, cls: '' }
  return <span className={`badge-status ${cls}`}>{label}</span>
}

export default function SolicitudesPage() {
  const [solicitudes, setSolicitudes] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [showAll, setShowAll]         = useState(false)
  const [procesando, setProcesando]   = useState(null) // id en proceso

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/api/admin/tenant-requests', {
        params: showAll ? { status: 'all' } : {},
      })
      setSolicitudes(data.solicitudes || [])
    } catch (err) {
      setError(err?.response?.data?.error || 'Error al cargar solicitudes')
    } finally {
      setLoading(false)
    }
  }, [showAll])

  useEffect(() => { cargar() }, [cargar])

  async function handleAccion(id, accion) {
    setProcesando(id)
    try {
      await api.post(`/api/admin/tenant-requests/${id}/${accion}`)
      await cargar()
    } catch (err) {
      alert(err?.response?.data?.error || `Error al ${accion === 'approve' ? 'aprobar' : 'rechazar'}`)
    } finally {
      setProcesando(null)
    }
  }

  const pendientes = solicitudes.filter(s => s.status === 'pending').length

  return (
    <div className="page" style={{ maxWidth: 740 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Solicitudes de acceso</h1>
          <p className="page-subtitle">
            {loading ? 'Cargando…' : pendientes > 0 ? `${pendientes} pendiente${pendientes > 1 ? 's' : ''}` : 'Sin pendientes'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showAll}
              onChange={e => setShowAll(e.target.checked)}
            />
            Ver todas
          </label>
          <button className="btn-secondary" onClick={cargar} disabled={loading}>
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="config-card" style={{ borderColor: 'var(--danger)', marginBottom: 16 }}>
          <p style={{ color: 'var(--danger)', padding: '12px 16px', margin: 0 }}>{error}</p>
        </div>
      )}

      {!loading && solicitudes.length === 0 && (
        <div className="config-card">
          <p style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-3)' }}>
            {showAll ? 'No hay solicitudes registradas.' : 'No hay solicitudes pendientes.'}
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {solicitudes.map(s => (
          <div key={s.id} className="config-card" style={{ opacity: procesando === s.id ? 0.6 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{s.email}</span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  ID Telegram: {s.telegram_user_id || '—'} · {formatFecha(s.created_at)}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusBadge status={s.status} />
                {s.status === 'pending' && (
                  <>
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 13 }}
                      disabled={procesando === s.id}
                      onClick={() => handleAccion(s.id, 'approve')}
                    >
                      ✓ Aprobar
                    </button>
                    <button
                      className="btn-danger"
                      style={{ fontSize: 13 }}
                      disabled={procesando === s.id}
                      onClick={() => handleAccion(s.id, 'reject')}
                    >
                      ✕ Rechazar
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
