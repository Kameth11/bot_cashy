import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useApp } from '../contexts/AppContext'

export default function NavBar() {
  const { user, logout } = useAuth()
  const { openNuevo }    = useApp()
  const navigate         = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const links = [
    ['/', 'Dashboard'],
    ['/movimientos', 'Movimientos'],
    ['/agenda', 'Agenda'],
    ['/config', 'Config'],
    ...(user?.isAdmin ? [['/solicitudes', 'Solicitudes']] : []),
  ]

  const userLabel = user?.email
    ? user.email.split('@')[0]
    : user?.userId ? `ID ${String(user.userId).slice(-4)}` : '—'

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <span className="navbar-logo">🦷 Cashy</span>
        <div className="navbar-links">
          {links.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
            >
              {label}
            </NavLink>
          ))}
        </div>
      </div>

      <div className="navbar-right">
        <button className="btn-nuevo" onClick={openNuevo}>+ Nuevo</button>
        <div className="navbar-divider" />
        <div className="bot-status">
          <span className="bot-dot" />
          Bot activo
        </div>
        <div className="navbar-divider" />
        <span className="navbar-user" title={user?.email || user?.userId}>
          {userLabel}
        </span>
        <button
          className="logout-btn-nav"
          onClick={handleLogout}
          title="Cerrar sesión"
        >
          ✕
        </button>
      </div>
    </nav>
  )
}
