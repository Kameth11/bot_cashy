import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import './index.css'

// Una versión nueva tiene que llegar sola, sin que nadie fuerce la recarga (en el
// celular no se puede). Se busca al abrir/volver a la app y cada 60s; cuando el
// service worker nuevo toma el control, se recarga la página una vez.
const habiaControlador = !!navigator.serviceWorker?.controller
let recargando = false
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (!habiaControlador || recargando) return
  recargando = true
  window.location.reload()
})

registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (!registration) return
    const buscar = () => registration.update().catch(() => {})
    setInterval(buscar, 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') buscar()
    })
    window.addEventListener('online', buscar)
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
