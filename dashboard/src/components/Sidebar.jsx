import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LogOut, Home, ListChecks, PlusCircle, Settings } from 'lucide-react';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Cashy</h2>
        <p>{user?.email || `ID: ${user?.userId?.slice(-4)}`}</p>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <Home size={18} />
          <span>Dashboard</span>
        </NavLink>
        <NavLink to="/movimientos" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <ListChecks size={18} />
          <span>Movimientos</span>
        </NavLink>
        <NavLink to="/nuevo" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <PlusCircle size={18} />
          <span>Nuevo movimiento</span>
        </NavLink>
        <NavLink to="/config" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <Settings size={18} />
          <span>Config</span>
        </NavLink>
      </nav>

      <button onClick={handleLogout} className="logout-btn">
        <LogOut size={16} />
        <span>Cerrar sesión</span>
      </button>
    </aside>
  );
}
