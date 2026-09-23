import { NavLink } from 'react-router-dom'
import { LayoutDashboard, List, CalendarDays, Settings, Plus } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import { useAuth } from '../hooks/useAuth'

export default function BottomNav() {
  const { openNuevo } = useApp()
  const { user, puede } = useAuth()

  return (
    <nav className="bottom-nav">
      {puede('ver_balance') && (
        <NavLink to="/" end className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <LayoutDashboard size={20} />
          <span>Inicio</span>
        </NavLink>
      )}
      {puede('ver_movimientos') && (
        <NavLink to="/movimientos" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <List size={20} />
          <span>Movimientos</span>
        </NavLink>
      )}
      {puede('cargar_movimientos') && (
        <button className="bottom-nav-fab" onClick={openNuevo}>
          <Plus size={22} />
        </button>
      )}
      {puede('ver_agenda') && (
        <NavLink to="/agenda" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <CalendarDays size={20} />
          <span>Agenda</span>
        </NavLink>
      )}
      <NavLink to="/config" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
        <Settings size={20} />
        <span>Config</span>
      </NavLink>
    </nav>
  )
}
