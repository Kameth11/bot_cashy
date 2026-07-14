import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useNavigate, useSearchParams } from 'react-router-dom'
import CotizacionWidget from '../components/CotizacionWidget'
import { api } from '../services/api'

// ── Helpers ────────────────────────────────────────────────────────────────

const PERMISOS_LABELS = {
  ver_agenda:         'Ver agenda',
  editar_agenda:      'Editar agenda',
  ver_movimientos:    'Ver movimientos',
  cargar_movimientos: 'Cargar movimientos',
  editar_movimientos: 'Editar movimientos',
  ver_balance:        'Ver balance / reportes',
}

const PRESET_LABELS = {
  odontologo: 'Odontólogo',
  recepcion:  'Recepción',
  contadora:  'Contadora',
}

function detectarPreset(permisos, presets) {
  if (!presets) return null
  const sorted = [...permisos].sort().join(',')
  for (const [nombre, permsList] of Object.entries(presets)) {
    if ([...permsList].sort().join(',') === sorted) return nombre
  }
  return null
}

function formatFecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

// ── Tab: General ───────────────────────────────────────────────────────────

function TabGeneral({ user, onLogout }) {
  const [showToken, setShowToken] = useState(false)

  const userId    = user?.userId || '—'
  const userEmail = user?.email  || '—'
  const tokenMask = userId.length > 6
    ? `${userId.slice(0, 3)}${'•'.repeat(Math.max(4, userId.length - 6))}${userId.slice(-3)}`
    : userId

  const presetNombre = detectarPreset(user?.permisos || [], {
    odontologo: ['ver_agenda', 'editar_agenda'],
    recepcion:  ['ver_agenda', 'editar_agenda', 'ver_movimientos', 'cargar_movimientos', 'editar_movimientos', 'ver_balance'],
    contadora:  ['ver_movimientos', 'ver_balance'],
  })

  return (
    <>
      <div className="config-card">
        <div className="config-card-header"><h2>Bot de Telegram</h2></div>
        <div className="config-card-body">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <input
              readOnly
              value={showToken ? userId : tokenMask}
              className="form-input"
              style={{ flex: 1, fontFamily: 'JetBrains Mono, monospace', background: 'var(--bg)' }}
            />
            <button className="btn-secondary" style={{ whiteSpace: 'nowrap' }} onClick={() => setShowToken(s => !s)}>
              {showToken ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Estado: <span style={{ color: '#36B37E', fontWeight: 600 }}>● Conectado</span>
            {userEmail !== '—' && ` · ${userEmail}`}
          </p>
        </div>
      </div>

      <div className="config-card">
        <div className="config-card-header"><h2>Cotizaciones</h2></div>
        <div className="config-card-body">
          <CotizacionWidget />
        </div>
      </div>

      <div className="config-card">
        <div className="config-card-header"><h2>Cuenta</h2></div>
        <div className="config-card-body" style={{ display: 'grid', gap: 10 }}>
          {[
            ['Telegram ID', userId],
            ['Email', userEmail],
            ['Rol', user?.isAdmin ? 'Administrador' : (presetNombre ? PRESET_LABELS[presetNombre] : 'Usuario')],
          ].map(([label, value]) => (
            <div key={label} className="config-row">
              <span className="config-label">{label}</span>
              <input readOnly value={value} className="form-input" style={{ background: 'var(--bg)' }} />
            </div>
          ))}
        </div>
      </div>

      <div className="config-card" style={{ borderColor: 'var(--red)' }}>
        <div className="config-card-header"><h2>Sesión</h2></div>
        <div className="config-card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-2)' }}>Cerrar sesión en este dispositivo.</p>
          <button className="btn-danger" onClick={onLogout}>Cerrar sesión</button>
        </div>
      </div>
    </>
  )
}

// ── Tab: Accesos ───────────────────────────────────────────────────────────

function PermisosEditor({ miembro, permisosDisponibles, presets, onGuardar }) {
  const [permisos, setPermisos]   = useState([...miembro.permisos])
  const [guardando, setGuardando] = useState(false)
  const [error, setError]         = useState(null)
  const [exito, setExito]         = useState(false)

  const presetActual = detectarPreset(permisos, presets)

  function aplicarPreset(nombre) {
    if (!presets?.[nombre]) return
    setPermisos([...presets[nombre]])
    setExito(false)
    setError(null)
  }

  function togglePermiso(p) {
    setPermisos(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
    setExito(false)
    setError(null)
  }

  async function handleGuardar() {
    setGuardando(true)
    setError(null)
    setExito(false)
    try {
      await api.put(`/api/accesos/${miembro.userId}/permisos`, { permisos })
      setExito(true)
      onGuardar(miembro.userId, permisos)
    } catch (err) {
      setError(err?.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  const hayCambios = [...permisos].sort().join(',') !== [...miembro.permisos].sort().join(',')

  return (
    <div className="config-card-body" style={{ borderTop: '1px solid var(--bg)', paddingTop: 14 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Preset:</span>
        {Object.entries(PRESET_LABELS).map(([key, label]) => (
          <button
            key={key}
            className={presetActual === key ? 'btn-primary' : 'btn-secondary'}
            style={{ fontSize: 12, padding: '4px 12px' }}
            onClick={() => aplicarPreset(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginBottom: 14 }}>
        {(permisosDisponibles || []).map(p => (
          <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={permisos.includes(p)} onChange={() => togglePermiso(p)} />
            {PERMISOS_LABELS[p] || p}
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn-primary" style={{ fontSize: 13 }} disabled={guardando || !hayCambios} onClick={handleGuardar}>
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {exito && <span style={{ color: 'var(--success)', fontSize: 13, fontWeight: 600 }}>✓ Guardado</span>}
        {error && <span style={{ color: 'var(--red)', fontSize: 13 }}>{error}</span>}
      </div>
    </div>
  )
}

function TabAccesos() {
  const [miembros, setMiembros]       = useState([])
  const [permisosDisp, setPermisosDisp] = useState([])
  const [presets, setPresets]         = useState({})
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [expandido, setExpandido]     = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/api/accesos')
      setMiembros(data.miembros || [])
      setPermisosDisp(data.permisosDisponibles || [])
      setPresets(data.presets || {})
    } catch (err) {
      setError(err?.response?.data?.error || 'Error al cargar accesos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  function handlePermisoActualizado(userId, nuevosPermisos) {
    setMiembros(prev => prev.map(m => m.userId === userId ? { ...m, permisos: nuevosPermisos } : m))
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
          {loading ? 'Cargando…' : `${miembros.length} miembro${miembros.length !== 1 ? 's' : ''} en el consultorio`}
        </p>
        <button className="btn-secondary" onClick={cargar} disabled={loading} style={{ fontSize: 13 }}>
          Actualizar
        </button>
      </div>

      {error && (
        <div className="config-card" style={{ borderColor: 'var(--red)', marginBottom: 12 }}>
          <p style={{ color: 'var(--red)', padding: '12px 16px', margin: 0, fontSize: 13 }}>{error}</p>
        </div>
      )}

      {!loading && miembros.length === 0 && (
        <div className="config-card">
          <p style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            No hay miembros registrados todavía.
          </p>
        </div>
      )}

      {miembros.map(m => (
        <div key={m.userId} className="config-card">
          <div
            className="config-card-header"
            style={{ cursor: m.isOwner ? 'default' : 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            onClick={() => !m.isOwner && setExpandido(expandido === m.userId ? null : m.userId)}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {m.email || `ID ${String(m.userId).slice(-4)}`}
                {m.isOwner && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>🔒 Dueño</span>}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>
                {m.isOwner
                  ? 'Todos los permisos'
                  : m.permisos.length === 0
                    ? 'Sin permisos asignados'
                    : (detectarPreset(m.permisos, presets)
                        ? PRESET_LABELS[detectarPreset(m.permisos, presets)]
                        : `${m.permisos.length} permisos custom`)
                }
              </span>
            </div>
            {!m.isOwner && (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{expandido === m.userId ? '▲' : '▼'}</span>
            )}
          </div>

          {expandido === m.userId && (
            <PermisosEditor
              miembro={m}
              permisosDisponibles={permisosDisp}
              presets={presets}
              onGuardar={handlePermisoActualizado}
            />
          )}
        </div>
      ))}
    </>
  )
}

// ── Tab: Solicitudes ───────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = {
    pending:  { label: 'Pendiente', cls: 'pendiente' },
    approved: { label: 'Aprobada',  cls: 'cobrado'   },
    rejected: { label: 'Rechazada', cls: 'egreso'    },
  }
  const { label, cls } = cfg[status] || { label: status, cls: '' }
  return <span className={`badge-status ${cls}`}>{label}</span>
}

function TabSolicitudes() {
  const [solicitudes, setSolicitudes] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [showAll, setShowAll]         = useState(false)
  const [procesando, setProcesando]   = useState(null)

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
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
          {loading ? 'Cargando…' : pendientes > 0 ? `${pendientes} pendiente${pendientes > 1 ? 's' : ''}` : 'Sin pendientes'}
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            Ver todas
          </label>
          <button className="btn-secondary" onClick={cargar} disabled={loading} style={{ fontSize: 13 }}>
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="config-card" style={{ borderColor: 'var(--red)', marginBottom: 12 }}>
          <p style={{ color: 'var(--red)', padding: '12px 16px', margin: 0, fontSize: 13 }}>{error}</p>
        </div>
      )}

      {!loading && solicitudes.length === 0 && (
        <div className="config-card">
          <p style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            {showAll ? 'No hay solicitudes registradas.' : 'No hay solicitudes pendientes.'}
          </p>
        </div>
      )}

      {solicitudes.map(s => (
        <div key={s.id} className="config-card" style={{ opacity: procesando === s.id ? 0.6 : 1 }}>
          <div className="config-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{s.email}</span>
              <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>
                ID Telegram: {s.telegram_user_id || '—'} · {formatFecha(s.created_at)}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusBadge status={s.status} />
              {s.status === 'pending' && (
                <>
                  <button className="btn-secondary" style={{ fontSize: 13 }} disabled={procesando === s.id} onClick={() => handleAccion(s.id, 'approve')}>
                    ✓ Aprobar
                  </button>
                  <button className="btn-danger" style={{ fontSize: 13 }} disabled={procesando === s.id} onClick={() => handleAccion(s.id, 'reject')}>
                    ✕ Rechazar
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </>
  )
}

// ── ConfigPage principal ───────────────────────────────────────────────────

export default function ConfigPage() {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam  = searchParams.get('tab') || 'general'
  const activeTab = ['general', 'accesos', 'solicitudes'].includes(tabParam) ? tabParam : 'general'

  function setTab(tab) {
    setSearchParams(tab === 'general' ? {} : { tab })
  }

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const tabs = [
    { id: 'general',     label: 'General' },
    ...(user?.isAdmin ? [{ id: 'accesos',     label: 'Accesos'     }] : []),
    ...(user?.isAdmin ? [{ id: 'solicitudes', label: 'Solicitudes' }] : []),
  ]

  const subtitulos = {
    general:     'Cuenta y preferencias',
    accesos:     'Permisos por usuario',
    solicitudes: 'Solicitudes de acceso',
  }

  return (
    <div className="page" style={{ maxWidth: 740 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuración</h1>
          <p className="page-subtitle">{subtitulos[activeTab]}</p>
        </div>
      </div>

      {tabs.length > 1 && (
        <div className="config-tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`config-tab-btn${activeTab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'general'     && <TabGeneral user={user} onLogout={handleLogout} />}
      {activeTab === 'accesos'     && <TabAccesos />}
      {activeTab === 'solicitudes' && <TabSolicitudes />}
    </div>
  )
}
