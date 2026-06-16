import { createContext, useContext, useState, useCallback } from 'react'

const AppContext = createContext()

export function AppProvider({ children }) {
  const [reloadSignal, setReloadSignal] = useState(0)
  const [showNuevo, setShowNuevo]       = useState(false)
  const [nuevoError, setNuevoError]     = useState(null)
  const [creando, setCreando]           = useState(false)

  const triggerReload = useCallback(() => setReloadSignal(r => r + 1), [])
  const openNuevo  = useCallback(() => { setNuevoError(null); setShowNuevo(true) }, [])
  const closeNuevo = useCallback(() => { setShowNuevo(false); setNuevoError(null) }, [])

  return (
    <AppContext.Provider value={{
      reloadSignal, triggerReload,
      showNuevo, openNuevo, closeNuevo,
      nuevoError, setNuevoError,
      creando, setCreando,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => useContext(AppContext)
