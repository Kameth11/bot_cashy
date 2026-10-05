import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../services/api'

const INTERVALO_MS = 2000
const INTERVALO_429_MS = 8000

// Espera `ms`, o menos si alguien llama a ctrl.despertar() (por ejemplo al volver a
// la pestaña, que el navegador móvil suspendió mientras se estaba en Telegram).
function dormir(ms, ctrl) {
  return new Promise((resolve) => {
    ctrl.despertar = resolve
    ctrl.timer = setTimeout(resolve, ms)
  })
}

/**
 * Login "Entrar con Telegram": pide una solicitud al servidor y espera (polling)
 * a que la persona la apruebe en el bot. `onSesion({token, user})` se llama una sola
 * vez cuando se aprueba.
 *
 * estado: 'iniciando' | 'esperando' | 'rechazada' | 'vencida' | 'error'
 */
export function useLoginTelegram(onSesion) {
  const [estado, setEstado] = useState('iniciando')
  const [deepLink, setDeepLink] = useState(null)
  const [restante, setRestante] = useState(0)
  const [error, setError] = useState(null)
  const ctrlRef = useRef(null)
  const onSesionRef = useRef(onSesion)

  useEffect(() => { onSesionRef.current = onSesion }, [onSesion])

  const detener = useCallback(() => {
    const ctrl = ctrlRef.current
    if (ctrl) {
      ctrl.cancelado = true
      clearTimeout(ctrl.timer)
      if (ctrl.despertar) ctrl.despertar()
    }
    ctrlRef.current = null
  }, [])

  const iniciar = useCallback(async () => {
    detener()
    const ctrl = { cancelado: false, timer: null, despertar: null }
    ctrlRef.current = ctrl

    let datos
    try {
      const res = await api.post('/api/auth/telegram/start')
      datos = res.data
    } catch (err) {
      if (ctrl.cancelado) return
      setError(err?.response?.data?.error || 'No se pudo iniciar el ingreso con Telegram')
      setEstado('error')
      return
    }
    if (ctrl.cancelado) return

    const vence = Date.now() + datos.expiraEnSeg * 1000
    setDeepLink(datos.deepLink)
    setRestante(datos.expiraEnSeg)
    setError(null)
    setEstado('esperando')

    let espera = INTERVALO_MS
    while (!ctrl.cancelado) {
      await dormir(espera, ctrl)
      if (ctrl.cancelado) return
      espera = INTERVALO_MS

      try {
        const { data } = await api.post('/api/auth/telegram/status', { id: datos.id, secret: datos.secret })
        if (ctrl.cancelado) return
        if (data.estado === 'aprobada') {
          ctrl.cancelado = true
          try {
            await onSesionRef.current(data)
          } catch {
            setError('No se pudo completar el ingreso. Probá de nuevo.')
            setEstado('error')
          }
          return
        }
        if (data.estado === 'rechazada' || data.estado === 'vencida') {
          ctrl.cancelado = true
          setEstado(data.estado)
          return
        }
      } catch (err) {
        // Un 429 pide más espacio entre consultas; un corte de red se reintenta solo.
        if (err?.response?.status === 429) espera = INTERVALO_429_MS
      }

      if (Date.now() > vence) {
        ctrl.cancelado = true
        setEstado('vencida')
        return
      }
    }
  }, [detener])

  // Cuenta regresiva visible.
  useEffect(() => {
    if (estado !== 'esperando') return undefined
    const t = setInterval(() => setRestante(r => Math.max(0, r - 1)), 1000)
    return () => clearInterval(t)
  }, [estado])

  // Al volver a la pestaña (típico en el celular: se va a Telegram y se vuelve),
  // se consulta enseguida en vez de esperar al próximo intervalo.
  const consultarYa = useCallback(() => {
    const ctrl = ctrlRef.current
    if (ctrl && ctrl.despertar) ctrl.despertar()
  }, [])

  useEffect(() => {
    if (estado !== 'esperando') return undefined
    const alVolver = () => { if (document.visibilityState === 'visible') consultarYa() }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [estado, consultarYa])

  // Al salir de la pantalla se deja de consultar.
  useEffect(() => detener, [detener])

  return { estado, deepLink, restante, error, iniciar, detener, consultarYa }
}
