import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LogOut } from 'lucide-react';

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
          <span>Dashboard</span>
        </NavLink>
        <NavLink to="/agenda" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
          <span>Agenda</span>
        </NavLink>
      </nav>

      <button onClick={handleLogout} className="logout-btn">
        <LogOut size={16} />
        <span>Cerrar sesión</span>
      </button>
    </aside>
  );
}
