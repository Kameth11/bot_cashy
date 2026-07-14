import { NavLink } from 'react-router-dom'
import { LayoutDashboard, List, CalendarDays, Settings, Plus, Users } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { useAuth } from '../hooks/useAuth'

export default function BottomNav() {
  const { openNuevo } = useApp()
  const { user } = useAuth()

  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
        <LayoutDashboard size={20} />
        <span>Inicio</span>
      </NavLink>
      <NavLink to="/movimientos" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
        <List size={20} />
        <span>Movimientos</span>
      </NavLink>
      <button className="bottom-nav-fab" onClick={openNuevo}>
        <Plus size={22} />
      </button>
      <NavLink to="/agenda" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
        <CalendarDays size={20} />
        <span>Agenda</span>
      </NavLink>
      <NavLink to="/config" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
        <Settings size={20} />
        <span>Config</span>
      </NavLink>
      {user?.isAdmin && (
        <NavLink to="/solicitudes" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <Users size={20} />
          <span>Accesos</span>
        </NavLink>
      )}
    </nav>
  )
}
