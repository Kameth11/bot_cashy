import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'

const AppContext = createContext()

export function AppProvider({ children }) {
  const [reloadSignal, setReloadSignal] = useState(0)
  const [showNuevo, setShowNuevo]       = useState(false)
  const [nuevoError, setNuevoError]     = useState(null)
  const [creando, setCreando]           = useState(false)

  const triggerReload = useCallback(() => setReloadSignal(r => r + 1), [])

  // Toast con "Deshacer": uno a la vez (un cambio nuevo reemplaza al anterior).
  const [toast, setToast] = useState(null) // { id, mensaje, onDeshacer, estado }
  const timer = useRef(null)
  const cerrarToast = useCallback(() => { clearTimeout(timer.current); setToast(null) }, [])
  const mostrarToast = useCallback((mensaje, onDeshacer = null) => {
    clearTimeout(timer.current)
    setToast({ id: Date.now(), mensaje, onDeshacer, estado: 'listo' })
    timer.current = setTimeout(() => setToast(null), onDeshacer ? 10000 : 4000)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  const deshacerToast = useCallback(async () => {
    const accion = toast?.onDeshacer
    if (!accion) return
    clearTimeout(timer.current)
    setToast(t => t && { ...t, estado: 'deshaciendo' })
    try {
      await accion()
      setToast({ id: Date.now(), mensaje: 'Cambio deshecho', onDeshacer: null, estado: 'listo' })
      setReloadSignal(r => r + 1)
    } catch (err) {
      setToast({ id: Date.now(), mensaje: err?.response?.data?.error || 'No se pudo deshacer', onDeshacer: null, estado: 'error' })
    }
    timer.current = setTimeout(() => setToast(null), 4000)
  }, [toast])
  const openNuevo  = useCallback(() => { setNuevoError(null); setShowNuevo(true) }, [])
  const closeNuevo = useCallback(() => { setShowNuevo(false); setNuevoError(null) }, [])

  return (
    <AppContext.Provider value={{
      reloadSignal, triggerReload,
      showNuevo, openNuevo, closeNuevo,
      nuevoError, setNuevoError,
      creando, setCreando,
      mostrarToast,
    }}>
      {children}
      {toast && (
        <div className={`toast${toast.estado === 'error' ? ' toast-error' : ''}`} role="status" aria-live="polite">
          <span className="toast-msg">{toast.mensaje}</span>
          {toast.onDeshacer && (
            <button className="toast-btn" onClick={deshacerToast} disabled={toast.estado === 'deshaciendo'}>
              {toast.estado === 'deshaciendo' ? 'Deshaciendo…' : 'Deshacer'}
            </button>
          )}
          <button className="toast-x" onClick={cerrarToast} aria-label="Cerrar">×</button>
        </div>
      )}
    </AppContext.Provider>
  )
}

export const useApp = () => useContext(AppContext)
