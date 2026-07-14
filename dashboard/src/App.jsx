import { Routes, Route, Navigate } from 'react-router-dom'
import { useCallback } from 'react'
import { useAuth } from './hooks/useAuth'
import { AppProvider, useApp } from './contexts/AppContext'
import AuthGuard from './components/AuthGuard'
import NavBar from './components/NavBar'
import BottomNav from './components/BottomNav'
import NuevoMovimientoModal from './components/NuevoMovimientoModal'
import ErrorBoundary from './components/ErrorBoundary'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import AgendaPage from './pages/AgendaPage'
import MovimientosPage from './pages/MovimientosPage'
import ConfigPage from './pages/ConfigPage'
import SolicitudesPage from './pages/SolicitudesPage'
import AccesosPage from './pages/AccesosPage'
import { api } from './services/api'

function LayoutWithModal() {
  const { showNuevo, closeNuevo, nuevoError, setNuevoError, creando, setCreando, triggerReload } = useApp()
  const { puede } = useAuth()

  // Ruta raíz: redirigir al primer destino permitido según permisos
  const defaultRoute = puede('ver_balance') ? '/' : puede('ver_agenda') ? '/agenda' : '/config'

  const handleCrear = useCallback(async (payload) => {
    setNuevoError(null)
    setCreando(true)
    try {
      await api.post('/api/movimientos', payload)
      closeNuevo()
      triggerReload()
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Error al guardar el movimiento'
      setNuevoError(msg)
    } finally {
      setCreando(false)
    }
  }, [closeNuevo, triggerReload, setNuevoError, setCreando])

  return (
    <div className="app-layout">
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/"            element={puede('ver_balance')     ? <Dashboard />       : <Navigate to={defaultRoute} replace />} />
          <Route path="/movimientos" element={puede('ver_movimientos') ? <MovimientosPage /> : <Navigate to={defaultRoute} replace />} />
          <Route path="/agenda"      element={puede('ver_agenda')      ? <AgendaPage />      : <Navigate to={defaultRoute} replace />} />
          <Route path="/config"      element={<ConfigPage />} />
          <Route path="/solicitudes" element={<SolicitudesPage />} />
          <Route path="/accesos"     element={<AccesosPage />} />
          <Route path="*"            element={<Navigate to={defaultRoute} replace />} />
        </Routes>
      </main>
      <BottomNav />
      {showNuevo && (
        <NuevoMovimientoModal
          guardando={creando}
          error={nuevoError}
          onGuardar={handleCrear}
          onCerrar={closeNuevo}
        />
      )}
    </div>
  )
}

export default function App() {
  const { loading } = useAuth()

  if (loading) return <div className="center-screen">Cargando...</div>

  return (
    <ErrorBoundary>
      <AppProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <AuthGuard>
                <LayoutWithModal />
              </AuthGuard>
            }
          />
        </Routes>
      </AppProvider>
    </ErrorBoundary>
  )
}
