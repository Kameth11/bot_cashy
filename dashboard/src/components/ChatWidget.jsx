import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle, Mic, Send, Minimize2, Square, Trash2, Clock, WifiOff, Paperclip } from 'lucide-react'
import { api } from '../services/api'
import { useServerEvent } from '../hooks/useMovimientosEvents'
import { encolar, listarPendientes, quitar } from '../services/chatCola'
import { renderTelegramMarkdown } from '../utils/telegramMarkdown'
import { crearGrabacion, soportaGrabacion } from '../services/grabadora'
import { blobAWav } from '../utils/audioWav'
import { prepararArchivo, ArchivoNoSoportado } from '../utils/imagen'

// Chat con Cashy dentro del dashboard: es el MISMO bot que Telegram (mismas
// reglas, comandos, confirmaciones y permisos), servido por /api/chat. Sin
// internet, lo que se escribe o graba queda en una cola en el dispositivo y se
// manda solo al volver la conexión.

const MAX_AUDIO_SEG = 120 // igual que MAX_VOICE_DURATION_SECONDS del bot
const ATAJOS = [
  ['Balance', '/balance'],
  ['Hoy', '/hoy'],
  ['Pendientes', '/pendientes'],
  ['Ayuda', '/ayuda'],
]

function esErrorDeRed(err) {
  return !err?.response
}

function esDelDashboard(url) {
  try {
    return new URL(url).origin === window.location.origin
  } catch {
    return false
  }
}

function horaCorta(ts) {
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function Burbuja({ mensaje, onBoton, ocupado }) {
  const esBot = mensaje.de === 'bot'
  return (
    <div className={`chat-msg ${esBot ? 'chat-msg-bot' : 'chat-msg-yo'}`}>
      <div className="chat-bubble">
        <div className="chat-text">
          {esBot && mensaje.formato === 'Markdown' ? renderTelegramMarkdown(mensaje.texto) : mensaje.texto}
        </div>
        <div className="chat-meta">
          {mensaje.pendiente ? <><Clock size={11} /> {mensaje.pendiente}</> : horaCorta(mensaje.ts)}
        </div>
      </div>
      {esBot && mensaje.botones?.length > 0 && (
        <div className="chat-botones">
          {mensaje.botones.map((fila, i) => (
            <div className="chat-botones-fila" key={i}>
              {fila.map((b, j) => (b.url ? (
                // Un link al propio dashboard (ej. "Ver Dashboard") se abre acá mismo.
                <a key={j} className="chat-boton" href={b.url}
                  {...(esDelDashboard(b.url) ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>{b.texto}</a>
              ) : (
                <button key={j} className="chat-boton" disabled={ocupado} onClick={() => onBoton(mensaje, b)}>
                  {b.texto}
                </button>
              )))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ChatWidget() {
  const [abierto, setAbierto] = useState(false)
  const [mensajes, setMensajes] = useState([])
  const [pendientes, setPendientes] = useState([])
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [noLeidos, setNoLeidos] = useState(0)
  const [grabando, setGrabando] = useState(null) // { inicio, segundos }

  const revRef = useRef(0)
  const abiertoRef = useRef(abierto)
  useEffect(() => { abiertoRef.current = abierto }, [abierto])
  const listaRef = useRef(null)
  const grabacionRef = useRef(null)
  const archivoRef = useRef(null)
  const vaciandoRef = useRef(false)
  const enVueloRef = useRef(false) // hay un POST al bot esperando respuesta
  const avisoTimer = useRef(null)

  const mostrarAviso = useCallback((msg) => {
    clearTimeout(avisoTimer.current)
    setAviso(msg)
    avisoTimer.current = setTimeout(() => setAviso(null), 4000)
  }, [])

  const aplicar = useCallback((snap) => {
    if (!snap || !Array.isArray(snap.mensajes)) return
    revRef.current = snap.rev
    setMensajes(prev => {
      const nuevosBot = snap.mensajes.filter(m => m.de === 'bot' && !prev.some(p => p.id === m.id)).length
      if (nuevosBot && !abiertoRef.current && prev.length) setNoLeidos(n => n + nuevosBot)
      return snap.mensajes
    })
    if (snap.avisos?.length) mostrarAviso(snap.avisos[snap.avisos.length - 1])
  }, [mostrarAviso])

  const cargar = useCallback(async () => {
    try {
      const { data } = await api.get('/api/chat')
      aplicar(data)
    } catch {
      // sin conexión: se muestra lo que ya había
    }
  }, [aplicar])

  const refrescarPendientes = useCallback(async () => {
    setPendientes(await listarPendientes())
  }, [])

  // Manda un ítem (texto o audio) al bot. Devuelve 'ok', 'red' o 'error'.
  const mandar = useCallback(async (item) => {
    enVueloRef.current = true
    try {
      let respuesta
      if (item.tipo === 'audio') {
        respuesta = await api.post(`/api/chat/audio?duracion=${item.duracion || 0}`, item.blob, {
          headers: { 'Content-Type': item.mime || item.blob.type },
          timeout: 150000,
        })
      } else if (item.tipo === 'archivo') {
        const query = new URLSearchParams({ nombre: item.nombre || '', caption: item.caption || '' })
        respuesta = await api.post(`/api/chat/archivo?${query}`, item.blob, {
          headers: { 'Content-Type': item.mime || item.blob.type },
          timeout: 150000,
        })
      } else {
        respuesta = await api.post('/api/chat/mensaje', { texto: item.texto }, { timeout: 150000 })
      }
      const { data } = respuesta
      aplicar(data)
      return 'ok'
    } catch (err) {
      if (esErrorDeRed(err)) return 'red'
      mostrarAviso(err.response?.data?.error || 'No se pudo enviar')
      return 'error'
    } finally {
      enVueloRef.current = false
    }
  }, [aplicar, mostrarAviso])

  // Vacía la cola en orden. Si se corta la red a mitad de camino, frena y
  // reintenta en la próxima oportunidad.
  const vaciarCola = useCallback(async () => {
    if (vaciandoRef.current || !navigator.onLine) return
    vaciandoRef.current = true
    setOcupado(true)
    try {
      // Siempre se vuelve a leer la cola: lo que se agregó mientras se mandaba
      // el ítem anterior (otro audio, otro texto) se manda en esta misma vuelta.
      while (navigator.onLine) {
        const [item] = await listarPendientes()
        if (!item) break
        const r = await mandar(item)
        if (r === 'red') break
        await quitar(item.id)
        await refrescarPendientes()
      }
    } finally {
      vaciandoRef.current = false
      setOcupado(false)
      refrescarPendientes()
    }
  }, [mandar, refrescarPendientes])

  const enviarItem = useCallback(async (item) => {
    await encolar(item)
    await refrescarPendientes()
    if (!navigator.onLine) {
      mostrarAviso('Sin conexión: se manda cuando vuelva internet')
      return
    }
    await vaciarCola()
  }, [refrescarPendientes, vaciarCola, mostrarAviso])

  useEffect(() => {
    // Primera carga fuera del cuerpo del efecto (los setState llegan después).
    const inicial = setTimeout(() => {
      cargar()
      refrescarPendientes().then(() => vaciarCola())
    }, 0)
    const alVolver = () => { setOnline(true); cargar(); vaciarCola() }
    const alIrse = () => setOnline(false)
    const alMostrar = () => { if (document.visibilityState === 'visible') { cargar(); vaciarCola() } }
    window.addEventListener('online', alVolver)
    window.addEventListener('offline', alIrse)
    document.addEventListener('visibilitychange', alMostrar)
    return () => {
      clearTimeout(inicial)
      window.removeEventListener('online', alVolver)
      window.removeEventListener('offline', alIrse)
      document.removeEventListener('visibilitychange', alMostrar)
    }
  }, [cargar, refrescarPendientes, vaciarCola])

  // Otro dispositivo/pestaña (o una respuesta que llegó después) cambió el chat.
  // Mientras esta pestaña espera su propia respuesta no hace falta pedir nada:
  // la respuesta trae la conversación completa. Los avisos seguidos se agrupan.
  const sseTimer = useRef(null)
  useServerEvent('chat_updated', (data) => {
    if (enVueloRef.current || (data?.rev && data.rev <= revRef.current)) return
    clearTimeout(sseTimer.current)
    sseTimer.current = setTimeout(cargar, 400)
  })

  useEffect(() => {
    const el = listaRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [mensajes, pendientes, abierto, ocupado])

  function abrir() {
    setAbierto(true)
    setNoLeidos(0)
  }

  function enviarTexto(valor) {
    const limpio = (valor ?? texto).trim()
    if (!limpio) return
    if (valor === undefined) setTexto('')
    abrir()
    enviarItem({ tipo: 'texto', texto: limpio })
  }

  async function apretarBoton(mensaje, boton) {
    if (!navigator.onLine) {
      mostrarAviso('Necesitás conexión para confirmar')
      return
    }
    setOcupado(true)
    enVueloRef.current = true
    try {
      const { data } = await api.post('/api/chat/boton', { mensajeId: mensaje.id, data: boton.data }, { timeout: 150000 })
      aplicar(data)
    } catch (err) {
      if (err.response?.data?.mensajes) aplicar(err.response.data)
      else mostrarAviso(esErrorDeRed(err) ? 'Sin conexión' : (err.response?.data?.error || 'No se pudo procesar'))
    } finally {
      enVueloRef.current = false
      setOcupado(false)
    }
  }

  async function procesarGrabacion(resultado) {
    if (resultado.error === 'permiso') return mostrarAviso('No hay permiso para usar el micrófono')
    if (resultado.error) return mostrarAviso('No se pudo grabar el audio. Probá de nuevo.')
    if (resultado.corto) return mostrarAviso('El audio es muy corto. Mantené el micrófono un poco más.')
    if (resultado.descartado) return
    // WAV mono 16 kHz: el formato que Gemini soporta sí o sí, igual en todos los
    // navegadores. Si el navegador no puede convertirlo, se manda como se grabó.
    let item = { tipo: 'audio', blob: resultado.blob, mime: resultado.mime, duracion: resultado.duracion }
    try {
      const wav = await blobAWav(resultado.blob)
      item = { ...item, blob: wav, mime: 'audio/wav' }
    } catch {
      // se manda el original
    }
    abrir()
    enviarItem(item)
  }

  async function alElegirArchivo(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite elegir el mismo archivo otra vez
    if (!file) return
    try {
      const { blob, mime, nombre } = await prepararArchivo(file)
      // Lo que ya estaba escrito en la barra viaja como pista ("gasto", "agenda"...).
      const caption = texto.trim()
      setTexto('')
      abrir()
      enviarItem({ tipo: 'archivo', blob, mime, nombre, caption })
    } catch (err) {
      mostrarAviso(err instanceof ArchivoNoSoportado ? err.message : 'No se pudo adjuntar el archivo')
    }
  }

  function empezarGrabacion() {
    if (grabacionRef.current) return // ya hay una grabación en curso o pidiendo permiso
    if (!soportaGrabacion()) {
      mostrarAviso('Este navegador no permite grabar audio')
      return
    }
    // La barra pasa a "grabando" ya mismo (aunque el navegador todavía esté
    // pidiendo el micrófono) para que siempre haya un botón para cortar.
    setGrabando({ segundos: 0 })
    grabacionRef.current = crearGrabacion({
      maxSegundos: MAX_AUDIO_SEG,
      onTick: segundos => setGrabando({ segundos }),
      onFin: resultado => {
        grabacionRef.current = null
        setGrabando(null)
        procesarGrabacion(resultado)
      },
    })
  }

  // Si el chat se desmonta con el micrófono abierto, se suelta.
  useEffect(() => () => grabacionRef.current?.descartar(), [])

  const vistaPendientes = pendientes.map(p => ({
    id: `p-${p.id}`, de: 'yo', pendiente: online ? 'enviando…' : 'sin enviar', ts: p.ts,
    texto: p.tipo === 'audio'
      ? `🎤 Nota de voz (${p.duracion || 0}s)`
      : p.tipo === 'archivo' ? `${p.mime === 'application/pdf' ? '📄' : '📷'} ${p.nombre || 'Archivo'}` : p.texto,
  }))

  const barra = (
    <div className="chat-input-bar">
      {grabando ? (
        <>
          <button className="chat-icon-btn" onClick={() => grabacionRef.current?.descartar()} title="Descartar">
            <Trash2 size={18} />
          </button>
          <div className="chat-grabando">
            <span className="chat-rec-dot" /> Grabando… {grabando.segundos}s
          </div>
          <button className="chat-send-btn" onClick={() => grabacionRef.current?.detener()} title="Enviar audio">
            <Square size={16} />
          </button>
        </>
      ) : (
        <>
          {!abierto && (
            <button className="chat-icon-btn chat-expand" onClick={abrir} title="Abrir chat">
              <MessageCircle size={18} />
              {noLeidos > 0 && <span className="chat-badge">{noLeidos}</span>}
            </button>
          )}
          <input ref={archivoRef} type="file" accept="image/*,application/pdf" hidden onChange={alElegirArchivo} />
          <button className="chat-icon-btn" onClick={() => archivoRef.current?.click()} title="Adjuntar foto o PDF">
            <Paperclip size={18} />
          </button>
          <input
            className="chat-input"
            value={texto}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarTexto() } }}
            placeholder="Escribile a Cashy…"
            maxLength={4000}
            enterKeyHint="send"
          />
          {texto.trim() ? (
            <button className="chat-send-btn" onClick={() => enviarTexto()} title="Enviar">
              <Send size={16} />
            </button>
          ) : (
            <button className="chat-send-btn" onClick={empezarGrabacion} title="Grabar audio">
              <Mic size={18} />
            </button>
          )}
        </>
      )}
    </div>
  )

  if (!abierto) {
    return (
      <div className="chat-dock">
        {aviso && <div className="chat-aviso">{aviso}</div>}
        {barra}
      </div>
    )
  }

  return (
    <div className="chat-panel" role="dialog" aria-label="Chat con Cashy">
      <div className="chat-header">
        <div className="chat-title">
          <MessageCircle size={18} /> Chat con Cashy
          {!online && <span className="chat-offline"><WifiOff size={13} /> sin conexión</span>}
        </div>
        <button className="chat-icon-btn" onClick={() => setAbierto(false)} title="Achicar">
          <Minimize2 size={18} />
        </button>
      </div>
      <div className="chat-lista" ref={listaRef}>
        {mensajes.length === 0 && vistaPendientes.length === 0 && (
          <div className="chat-vacio">
            <p>Escribí o mandá un audio como en Telegram: <code>consulta Juan Perez $15000 efectivo</code>, <code>gasto insumos $-500</code> o cualquier comando.</p>
            <div className="chat-atajos">
              {ATAJOS.map(([label, cmd]) => (
                <button key={cmd} className="chat-boton" onClick={() => enviarTexto(cmd)}>{label}</button>
              ))}
            </div>
          </div>
        )}
        {mensajes.map(m => <Burbuja key={m.id} mensaje={m} onBoton={apretarBoton} ocupado={ocupado} />)}
        {vistaPendientes.map(m => <Burbuja key={m.id} mensaje={m} />)}
        {ocupado && online && <div className="chat-escribiendo">Cashy está escribiendo…</div>}
      </div>
      {aviso && <div className="chat-aviso chat-aviso-panel">{aviso}</div>}
      {barra}
    </div>
  )
}

