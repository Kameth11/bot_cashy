import { Routes, Route, Navigate, useLocation, useMatch } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { AppProvider, useApp } from './contexts/AppContext'
import AuthGuard from './components/AuthGuard'
import NavBar from './components/NavBar'
import BottomNav from './components/BottomNav'
import NuevoMovimientoModal from './components/NuevoMovimientoModal'
import NuevoPersonalModal from './components/NuevoPersonalModal'
import NuevoCasaModal from './components/NuevoCasaModal'
import ErrorBoundary from './components/ErrorBoundary'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import AgendaPage from './pages/AgendaPage'
import MovimientosPage from './pages/MovimientosPage'
import ConfigPage from './pages/ConfigPage'
import PersonalPage from './pages/PersonalPage'
import CasaPage from './pages/CasaPage'
import { api } from './services/api'
import { deshacerAlta } from './services/deshacer'

function LayoutWithModal() {
  const { showNuevo, closeNuevo, nuevoError, setNuevoError, creando, setCreando, triggerReload, mostrarToast } = useApp()
  const { puede, esDueno, puedePersonal } = useAuth()
  const location = useLocation()

  // Ruta raíz: redirigir al primer destino permitido según permisos
  const defaultRoute = puede('ver_balance') ? '/' : puede('ver_agenda') ? '/agenda' : '/config'

  // El botón "+ Nuevo" es el mismo, pero en la vista Personal tiene que crear
  // un movimiento personal, no uno del consultorio. La sección Personal es
  // solo del dueño — si un invitado llega a esta ruta (redirect en curso),
  // no la tratamos como "en personal" para no pedir /api/personal/* de más.
  const enPersonal = puedePersonal && location.pathname.startsWith('/personal')

  // Lo mismo para una casa compartida: el gasto se carga en la casa que se está
  // mirando (/casa/:casaId). En /casa a secas todavía no hay una elegida.
  const matchCasa = useMatch('/casa/:casaId')
  const casaId = esDueno ? matchCasa?.params.casaId : undefined
  const enSeccionCasa = esDueno && location.pathname.startsWith('/casa')

  // Sin casa elegida no hay dónde cargar nada: no se deja abierto un modal "+ Nuevo".
  useEffect(() => {
    if (enSeccionCasa && !casaId && showNuevo) closeNuevo()
  }, [enSeccionCasa, casaId, showNuevo, closeNuevo])

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
      const ruta = casaId
        ? `/api/casa/${casaId}/movimientos`
        : enPersonal ? '/api/personal/movimientos' : '/api/movimientos'
      const { data } = await api.post(ruta, payload)
      closeNuevo()
      triggerReload()
      // Solo los movimientos del consultorio tienen deshacer por ahora.
      const esConsultorio = !casaId && !enPersonal
      mostrarToast('Movimiento guardado', esConsultorio ? deshacerAlta(data?.movimiento?.idUnico) : null)
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Error al guardar el movimiento'
      setNuevoError(msg)
    } finally {
      setCreando(false)
    }
  }, [closeNuevo, triggerReload, setNuevoError, setCreando, enPersonal, casaId, mostrarToast])

  return (
    <div className="app-layout">
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/"            element={puede('ver_balance')     ? <Dashboard />       : <Navigate to={defaultRoute} replace />} />
          <Route path="/movimientos" element={puede('ver_movimientos') ? <MovimientosPage /> : <Navigate to={defaultRoute} replace />} />
          <Route path="/agenda"      element={puede('ver_agenda')      ? <AgendaPage />      : <Navigate to={defaultRoute} replace />} />
          <Route path="/config"      element={<ConfigPage />} />
          <Route path="/personal"    element={puedePersonal ? <PersonalPage /> : <Navigate to={defaultRoute} replace />} />
          <Route path="/casa"        element={esDueno ? <CasaPage /> : <Navigate to={defaultRoute} replace />} />
          <Route path="/casa/:casaId" element={esDueno ? <CasaPage /> : <Navigate to={defaultRoute} replace />} />
          <Route path="/solicitudes" element={<Navigate to="/config?tab=solicitudes" replace />} />
          <Route path="/accesos"     element={<Navigate to="/config?tab=accesos" replace />} />
          <Route path="*"            element={<Navigate to={defaultRoute} replace />} />
        </Routes>
      </main>
      <BottomNav />
      {showNuevo && casaId && (
        <NuevoCasaModal
          casaId={casaId}
          guardando={creando}
          error={nuevoError}
          onGuardar={handleCrear}
          onCerrar={closeNuevo}
        />
      )}
      {showNuevo && !enSeccionCasa && (enPersonal ? (
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
