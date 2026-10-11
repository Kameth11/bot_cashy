// Web Push de Cashy. Lo carga el service worker de la PWA (vite.config.js →
// workbox.importScripts), así que corre aparte de la app: no puede usar React ni la API.

self.addEventListener('push', (event) => {
  let datos = {}
  try {
    datos = event.data ? event.data.json() : {}
  } catch {
    datos = { cuerpo: event.data ? event.data.text() : '' }
  }

  event.waitUntil(
    self.registration.showNotification(datos.titulo || 'Cashy', {
      body: datos.cuerpo || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Mismo tag = un aviso nuevo del mismo tipo reemplaza al anterior en vez de apilarse.
      tag: datos.tag || undefined,
      data: { url: datos.url || '/' },
    })
  )
})

// Tocar el aviso: enfoca la app si ya está abierta (y la lleva a la pantalla del aviso)
// o la abre.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destino = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href

  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const ventana of ventanas) {
      if (new URL(ventana.url).origin !== self.location.origin) continue
      await ventana.focus()
      if ('navigate' in ventana) {
        try { await ventana.navigate(destino) } catch { /* si no puede navegar, queda enfocada */ }
      }
      return
    }
    await self.clients.openWindow(destino)
  })())
})
