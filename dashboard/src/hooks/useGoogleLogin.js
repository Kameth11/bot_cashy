import { useState, useEffect } from 'react'
import { api } from '../services/api'

const GSI_SRC = 'https://accounts.google.com/gsi/client'

// Carga el script de Google una sola vez; si falla (bloqueador, sin red) el botón
// simplemente no aparece y el resto del login sigue funcionando.
let cargaGsi = null
function cargarGsi() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve()
  if (!cargaGsi) {
    cargaGsi = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = GSI_SRC
      s.async = true
      s.onload = resolve
      s.onerror = () => { cargaGsi = null; reject(new Error('gsi')) }
      document.head.appendChild(s)
    })
  }
  return cargaGsi
}

/**
 * Qué ofrece el servidor y, si hay Client ID, deja listo Google Identity Services.
 * `onCredencial(token)` se llama cuando la persona elige su cuenta en el botón de Google.
 * @returns {{ disponible: boolean, renderBoton: (el: HTMLElement|null) => void }}
 */
export function useGoogleLogin(onCredencial) {
  const [clientId, setClientId] = useState(null)
  const [listo, setListo] = useState(false)

  useEffect(() => {
    let vivo = true
    api.get('/api/auth/config')
      .then(({ data }) => { if (vivo && data && data.googleClientId) setClientId(data.googleClientId) })
      .catch(() => {})
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    if (!clientId) return undefined
    let vivo = true
    cargarGsi()
      .then(() => {
        if (!vivo) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp) => { if (resp && resp.credential) onCredencial(resp.credential) },
          // Sin One Tap ni selección automática: solo entra quien toca el botón.
          auto_select: false,
          cancel_on_tap_outside: true,
        })
        setListo(true)
      })
      .catch(() => {})
    return () => { vivo = false }
  // onCredencial se lee en el callback de Google, que se registra una sola vez.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const renderBoton = (el) => {
    if (!el || !listo) return
    window.google.accounts.id.renderButton(el, {
      type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', width: 300, logo_alignment: 'left',
    })
  }

  return { disponible: Boolean(clientId) && listo, renderBoton }
}
