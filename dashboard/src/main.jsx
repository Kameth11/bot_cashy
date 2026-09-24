import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import './index.css'

// Chequea cada 60s si hay un build nuevo y recarga sola cuando lo hay, para
// que una pestaña/PWA ya abierta no se quede pegada a JS viejo (bug reportado
// en iOS Safari, pero el mismo registerSW.js genérico tampoco lo maneja en desktop).
registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (!registration) return
    setInterval(() => registration.update(), 60 * 1000)
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
