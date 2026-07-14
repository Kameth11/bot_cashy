import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { useNavigate } from 'react-router-dom'

const LABELS = {
  ver_agenda:          'Ver agenda',
  editar_agenda:       'Editar agenda',
  ver_movimientos:     'Ver movimientos',
  cargar_movimientos:  'Cargar movimientos',
  editar_movimientos:  'Editar movimientos',
  ver_balance:         'Ver balance / reportes',
}

const PRESET_LABELS = {
  odontologo: 'Odontólogo',
  recepcion:  'Recepción',
  contadora:  'Contadora',
}

function PermisosEditor({ miembro, permisosDisponibles, presets, onGuardar }) {
  const [permisos, setPermisos]   = useState([...miembro.permisos])
  const [guardando, setGuardando] = useState(false)
  const [error, setError]         = useState(null)
  const [exito, setExito]         = useState(false)

  const presetActual = detectarPreset(permisos, presets)

  function detectarPreset(perms, presetsDef) {
    const sorted = [...perms].sort().join(',')
    for (const [nombre, permsList] of Object.entries(presetsDef || {})) {
      if ([...permsList].sort().join(',') === sorted) return nombre
    }
    return null
  }

  function aplicarPreset(nombre) {
    if (!presets[nombre]) return
    setPermisos([...presets[nombre]])
    setExito(false)
    setError(null)
  }

  function togglePermiso(p) {
    setPermisos(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    )
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

  const haycambios = [...permisos].sort().join(',') !== [...miembro.permisos].sort().join(',')

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)', alignSelf: 'center' }}>Preset:</span>
        {Object.entries(PRESET_LABELS).map(([key, label]) => (
          <button
            key={key}
            className={presetActual === key ? 'btn-primary' : 'btn-secondary'}
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => aplicarPreset(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
        {permisosDisponibles.map(p => (
          <label
            key={p}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}
          >
            <input
              type="checkbox"
              checked={permisos.includes(p)}
              onChange={() => togglePermiso(p)}
            />
            {LABELS[p] || p}
          </label>
        ))}
      </div>

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          className="btn-primary"
          style={{ fontSize: 13 }}
          disabled={guardando || !haycambios}
          onClick={handleGuardar}
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        {exito  && <span style={{ color: 'var(--success)', fontSize: 13 }}>✓ Guardado</span>}
        {error  && <span style={{ color: 'var(--danger)',  fontSize: 13 }}>{error}</span>}
      </div>
    </div>
  )
}

export default function AccesosPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [miembros, setMiembros]                 = useState([])
  const [permisosDisponibles, setPermsDisp]     = useState([])
  const [presets, setPresets]                   = useState({})
  const [loading, setLoading]                   = useState(true)
  const [error, setError]                       = useState(null)
  const [expandido, setExpandido]               = useState(null)

  useEffect(() => {
    if (!user?.isAdmin) navigate('/', { replace: true })
  }, [user, navigate])

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/api/accesos')
      setMiembros(data.miembros || [])
      setPermsDisp(data.permisosDisponibles || [])
      setPresets(data.presets || {})
    } catch (err) {
      setError(err?.response?.data?.error || 'Error al cargar accesos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  function handlePermisoActualizado(userId, nuevosPermisos) {
    setMiembros(prev => prev.map(m =>
      m.userId === userId ? { ...m, permisos: nuevosPermisos } : m
    ))
  }

  return (
    <div className="page" style={{ maxWidth: 740 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Accesos</h1>
          <p className="page-subtitle">
            {loading ? 'Cargando…' : `${miembros.length} miembro${miembros.length !== 1 ? 's' : ''} en el consultorio`}
          </p>
        </div>
        <button className="btn-secondary" onClick={cargar} disabled={loading}>
          Actualizar
        </button>
      </div>

      {error && (
        <div className="config-card" style={{ borderColor: 'var(--danger)', marginBottom: 16 }}>
          <p style={{ color: 'var(--danger)', padding: '12px 16px', margin: 0 }}>{error}</p>
        </div>
      )}

      {!loading && miembros.length === 0 && (
        <div className="config-card">
          <p style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-3)' }}>
            No hay miembros registrados.
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {miembros.map(m => (
          <div key={m.userId} className="config-card">
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: m.isOwner ? 'default' : 'pointer' }}
              onClick={() => !m.isOwner && setExpandido(expandido === m.userId ? null : m.userId)}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>
                  {m.email || `ID ${String(m.userId).slice(-4)}`}
                  {m.isOwner && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-3)' }}>🔒 Dueño</span>}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {m.isOwner
                    ? 'Todos los permisos'
                    : m.permisos.length === 0
                      ? 'Sin permisos'
                      : m.permisos.map(p => LABELS[p] || p).join(', ')
                  }
                </span>
              </div>
              {!m.isOwner && (
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {expandido === m.userId ? '▲' : '▼'}
                </span>
              )}
            </div>

            {expandido === m.userId && (
              <PermisosEditor
                miembro={m}
                permisosDisponibles={permisosDisponibles}
                presets={presets}
                onGuardar={handlePermisoActualizado}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
