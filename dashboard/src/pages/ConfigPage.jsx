import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useNavigate } from 'react-router-dom'
import CotizacionWidget from '../components/CotizacionWidget'
import { api } from '../services/api'

export default function ConfigPage() {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()
  const [showToken, setShowToken] = useState(false)
  const [modoFullIA, setModoFullIA] = useState(Boolean(user?.modoFullIA))
  const [savingModoIA, setSavingModoIA] = useState(false)

  function handleLogout() {
    logout()
    navigate('/login')
  }

  async function handleToggleModoIA() {
    const next = !modoFullIA
    setSavingModoIA(true)
    try {
      await api.post('/api/config/modo-ia', { enabled: next })
      setModoFullIA(next)
    } catch (err) {
      console.error('Error al cambiar modo IA:', err)
    } finally {
      setSavingModoIA(false)
    }
  }

  const userId    = user?.userId || '—'
  const userEmail = user?.email  || '—'
  const tokenMask = userId.length > 6
    ? `${userId.slice(0, 3)}${'•'.repeat(Math.max(4, userId.length - 6))}${userId.slice(-3)}`
    : userId

  return (
    <div className="page" style={{ maxWidth: 740 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuración</h1>
          <p className="page-subtitle">Consultorio Odontológico</p>
        </div>
      </div>

      {/* Bot de Telegram */}
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
            <button
              className="btn-secondary"
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => setShowToken(s => !s)}
            >
              {showToken ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Estado: <span style={{ color: '#36B37E', fontWeight: 600 }}>● Conectado</span>
            {userEmail !== '—' && ` · ${userEmail}`}
          </p>
        </div>
      </div>

      {/* Modo IA */}
      <div className="config-card">
        <div className="config-card-header"><h2>Modo IA</h2></div>
        <div className="config-card-body">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13.5, marginBottom: 4 }}>
                Full IA: {modoFullIA
                  ? <span style={{ color: '#36B37E', fontWeight: 600 }}>Activado ✅</span>
                  : <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>Desactivado</span>}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
                Cuando está activado, todos tus mensajes se procesan con un motor de IA (OpenRouter) en vez de las reglas rápidas locales. Puede ser más lento y tiene costo por mensaje.
              </p>
            </div>
            <button
              className={modoFullIA ? 'btn-danger' : 'btn-secondary'}
              style={{ whiteSpace: 'nowrap' }}
              disabled={savingModoIA}
              onClick={handleToggleModoIA}
            >
              {modoFullIA ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        </div>
      </div>

      {/* Cotizaciones */}
      <div className="config-card">
        <div className="config-card-header"><h2>Cotizaciones</h2></div>
        <div className="config-card-body">
          <CotizacionWidget />
        </div>
      </div>

      {/* Información de la cuenta */}
      <div className="config-card">
        <div className="config-card-header"><h2>Cuenta</h2></div>
        <div className="config-card-body" style={{ display: 'grid', gap: 10 }}>
          {[
            ['Telegram ID', userId],
            ['Email', userEmail],
            ['Rol', user?.isAdmin ? 'Administrador' : 'Usuario'],
          ].map(([label, value]) => (
            <div key={label} className="config-row">
              <span className="config-label">{label}</span>
              <input readOnly value={value} className="form-input" style={{ background: 'var(--bg)' }} />
            </div>
          ))}
        </div>
      </div>

      <button className="btn-danger" onClick={handleLogout}>
        Cerrar sesión
      </button>
    </div>
  )
}
