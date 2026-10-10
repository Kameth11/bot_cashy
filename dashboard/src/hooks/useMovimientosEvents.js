import { useEffect, useRef } from 'react'
import { API_URL } from '../services/api'

const RECONNECT_DELAY_MS = 3000

// Se suscribe a /api/events (SSE) via fetch + ReadableStream para poder enviar
// el token en el header Authorization (en vez de la URL, como exigiria
// EventSource). Llama a onEvento(data) cada vez que el backend manda el evento
// pedido ('movimientos_updated' cuando cambian los movimientos del usuario, por
// el bot o por el propio dashboard; 'chat_updated' cuando cambia el chat web).
export function useServerEvent(nombreEvento, onEvento) {
  const onEventoRef = useRef(onEvento)
  useEffect(() => { onEventoRef.current = onEvento })

  useEffect(() => {
    let stopped = false
    let abortController = null
    let reconnectTimer = null

    async function connect() {
      const token = localStorage.getItem('cashy_token')
      if (!token) return

      abortController = new AbortController()
      try {
        const response = await fetch(`${API_URL}/api/events`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortController.signal,
        })
        // Token invalido/vencido: no tiene sentido reintentar con el mismo
        // token para siempre, solo generaria ruido en los logs del backend.
        if (response.status === 401) return
        if (!response.ok || !response.body) throw new Error('SSE no disponible')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (!stopped) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const events = buffer.split('\n\n')
          buffer = events.pop() // resto incompleto, se completa en la proxima lectura

          for (const chunk of events) {
            if (!chunk.includes(`event: ${nombreEvento}`)) continue
            let data = {}
            const linea = chunk.split('\n').find(l => l.startsWith('data: '))
            if (linea) {
              try { data = JSON.parse(linea.slice(6)) } catch { data = {} }
            }
            onEventoRef.current?.(data)
          }
        }
      } catch (err) {
        if (stopped || err.name === 'AbortError') return
      }

      if (!stopped) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
      }
    }

    connect()

    return () => {
      stopped = true
      abortController?.abort()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [nombreEvento])
}

export function useMovimientosEvents(onUpdate) {
  useServerEvent('movimientos_updated', () => onUpdate?.())
}
