import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { AppProvider, useApp } from './contexts/AppContext'
import AuthGuard from './components/AuthGuard'
import NavBar from './components/NavBar'
import BottomNav from './components/BottomNav'
import NuevoMovimientoModal from './components/NuevoMovimientoModal'
import NuevoPersonalModal from './components/NuevoPersonalModal'
import ErrorBoundary from './components/ErrorBoundary'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import AgendaPage from './pages/AgendaPage'
import MovimientosPage from './pages/MovimientosPage'
import ConfigPage from './pages/ConfigPage'
import PersonalPage from './pages/PersonalPage'
import { api } from './services/api'

function LayoutWithModal() {
  const { showNuevo, closeNuevo, nuevoError, setNuevoError, creando, setCreando, triggerReload } = useApp()
  const location = useLocation()

  // El botón "+ Nuevo" es el mismo, pero en la vista Personal tiene que crear
  // un movimiento personal, no uno del consultorio.
  const enPersonal = location.pathname.startsWith('/personal')

  const [categoriasPersonal, setCategoriasPersonal] = useState(null)

  useEffect(() => {
    if (!enPersonal || categoriasPersonal) return
    let active = true
    api.get('/api/personal/categorias')
      .then(res => { if (active) setCategoriasPersonal(res.data) })
      .catch(() => {})
    return () => { active = false }
  }, [enPersonal, categoriasPersonal])

  const handleCrear = useCallback(async (payload) => {
    setNuevoError(null)
    setCreando(true)
    try {
      await api.post(enPersonal ? '/api/personal/movimientos' : '/api/movimientos', payload)
      closeNuevo()
      triggerReload()
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Error al guardar el movimiento'
      setNuevoError(msg)
    } finally {
      setCreando(false)
    }
  }, [closeNuevo, triggerReload, setNuevoError, setCreando, enPersonal])

  return (
    <div className="app-layout">
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/"            element={<Dashboard />} />
          <Route path="/movimientos" element={<MovimientosPage />} />
          <Route path="/agenda"      element={<AgendaPage />} />
          <Route path="/config"      element={<ConfigPage />} />
          <Route path="/personal"    element={<PersonalPage />} />
          <Route path="*"            element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
      {showNuevo && (enPersonal ? (
        <NuevoPersonalModal
          categorias={categoriasPersonal}
          guardando={creando}
          error={nuevoError}
          onGuardar={handleCrear}
          onCerrar={closeNuevo}
        />
      ) : (
        <NuevoMovimientoModal
          guardando={creando}
          error={nuevoError}
          onGuardar={handleCrear}
          onCerrar={closeNuevo}
        />
      ))}
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
