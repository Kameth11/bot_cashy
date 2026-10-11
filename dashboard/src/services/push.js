import { api } from './api'

// Web Push desde el navegador: suscribirse / desuscribirse en ESTE dispositivo.
// El servidor guarda la suscripción (POST /api/notificaciones/suscripcion) y es quien
// manda los avisos; el service worker (public/push-sw.js) los muestra.

export function pushSoportado() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// iPhone/iPad solo permiten push con la app instalada en la pantalla de inicio.
export function esIosSinInstalar() {
  if (typeof navigator === 'undefined') return false
  const esIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const instalada = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
  return esIos && !instalada
}

// 'no_soportado' | 'bloqueado' | 'activo' | 'inactivo'
export async function estadoPush() {
  if (!pushSoportado()) return 'no_soportado'
  if (Notification.permission === 'denied') return 'bloqueado'
  try {
    const registro = await navigator.serviceWorker.ready
    const suscripcion = await registro.pushManager.getSubscription()
    return suscripcion && Notification.permission === 'granted' ? 'activo' : 'inactivo'
  } catch {
    return 'inactivo'
  }
}

// La clave pública VAPID viene en base64url; PushManager la quiere como bytes.
function aBytes(base64Url) {
  const relleno = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + relleno).replace(/-/g, '+').replace(/_/g, '/')
  const crudo = atob(base64)
  return Uint8Array.from(crudo, c => c.charCodeAt(0))
}

export async function activarPush(clavePublica) {
  if (!pushSoportado()) throw new Error('no_soportado')
  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') throw new Error('permiso_denegado')

  const registro = await navigator.serviceWorker.ready
  let suscripcion = await registro.pushManager.getSubscription()
  if (!suscripcion) {
    suscripcion = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: aBytes(clavePublica),
    })
  }
  await api.post('/api/notificaciones/suscripcion', { suscripcion: suscripcion.toJSON() })
}

export async function desactivarPush() {
  const registro = await navigator.serviceWorker.ready
  const suscripcion = await registro.pushManager.getSubscription()
  if (!suscripcion) return
  await api.delete('/api/notificaciones/suscripcion', { data: { endpoint: suscripcion.endpoint } })
  await suscripcion.unsubscribe()
}
