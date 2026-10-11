import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { api } from '../services/api'
import { useServerEvent } from '../hooks/useMovimientosEvents'
import { useApp } from './AppContext'

const NotificacionesContext = createContext(null)

const MAX_EN_LISTA = 30

// Avisos de la campanita. Llegan por el mismo canal en tiempo real (SSE) que el resto
// del dashboard; con la web cerrada los manda Web Push (ver services/push.js).
// Va dentro de AuthGuard: sin sesión no hay nada que pedir.
export function NotificacionesProvider({ children }) {
  const { mostrarToast } = useApp()
  const [lista, setLista] = useState([])
  const [noLeidas, setNoLeidas] = useState(0)
  const [push, setPush] = useState({ disponible: false, clavePublica: null })

  const aplicar = useCallback((data) => {
    setLista(Array.isArray(data?.notificaciones) ? data.notificaciones : [])
    setNoLeidas(Number(data?.noLeidas) || 0)
    if (data?.push) setPush(data.push)
  }, [])

  const recargar = useCallback(() => {
    api.get('/api/notificaciones').then(res => aplicar(res.data)).catch(() => {})
  }, [aplicar])

  // Primera carga. Si falla, la campanita queda vacía (el resto de la app anda igual).
  useEffect(() => {
    let activo = true
    api.get('/api/notificaciones')
      .then(res => { if (activo) aplicar(res.data) })
      .catch(() => {})
    return () => { activo = false }
  }, [aplicar])

  // Aviso nuevo en vivo. Al reconectar el SSE se pudieron perder avisos: se vuelve a pedir.
  useServerEvent('notificacion', (n) => {
    if (!n?.id) return
    setLista(prev => [n, ...prev.filter(x => x.id !== n.id)].slice(0, MAX_EN_LISTA))
    setNoLeidas(c => c + 1)
    mostrarToast(n.cuerpo ? `${n.titulo} — ${n.cuerpo}` : n.titulo)
  }, recargar)

  const marcarLeidas = useCallback(() => {
    setLista(prev => prev.map(n => ({ ...n, leida: true })))
    setNoLeidas(0)
    api.post('/api/notificaciones/leidas').catch(() => {})
  }, [])

  return (
    <NotificacionesContext.Provider value={{ lista, noLeidas, push, marcarLeidas }}>
      {children}
    </NotificacionesContext.Provider>
  )
}

export const useNotificaciones = () => useContext(NotificacionesContext)
