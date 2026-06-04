import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import AuthGuard from './components/AuthGuard'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import AgendaPage from './pages/AgendaPage'
import Proxim from './pages/Proxim'

function AuthenticatedLayout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/agenda" element={<AgendaPage />} />
          <Route path="/movimientos" element={<Proxim titulo="Movimientos" descripcion="Vista detallada de movimientos, próximamente." />} />
          <Route path="/nuevo" element={<Proxim titulo="Nuevo movimiento" descripcion="Carga manual de movimientos desde el panel, próximamente." />} />
          <Route path="/config" element={<Proxim titulo="Configuración" descripcion="Ajustes del consultorio, próximamente." />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  const { loading } = useAuth()

  if (loading) {
    return <div className="center-screen">Cargando...</div>
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <AuthGuard>
            <AuthenticatedLayout />
          </AuthGuard>
        }
      />
    </Routes>
  )
}
