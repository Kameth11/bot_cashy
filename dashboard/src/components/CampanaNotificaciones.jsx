import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotificaciones } from '../contexts/NotificacionesContext'
import { estadoPush, activarPush, desactivarPush, esIosSinInstalar } from '../services/push'

function hace(iso) {
  const segundos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (!Number.isFinite(segundos)) return ''
  if (segundos < 60) return 'ahora'
  if (segundos < 3600) return `hace ${Math.floor(segundos / 60)} min`
  if (segundos < 86400) return `hace ${Math.floor(segundos / 3600)} h`
  return `hace ${Math.floor(segundos / 86400)} d`
}

const MENSAJE_ERROR = {
  permiso_denegado: 'No diste permiso. Podés activarlo desde la configuración del sitio en tu navegador.',
}

function SeccionPush({ push }) {
  const [estado, setEstado] = useState('cargando')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let activo = true
    estadoPush().then(e => { if (activo) setEstado(e) })
    return () => { activo = false }
  }, [])

  // El servidor no puede mandar push: se dice por qué (antes la opción simplemente no aparecía).
  if (!push.disponible) {
    const motivo = push.motivo === 'claves_invalidas'
      ? 'Las claves de avisos del servidor no son válidas: hay que revisar VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en Railway.'
      : 'Los avisos con la app cerrada todavía no están activados en el servidor (faltan las claves VAPID en Railway). Mientras tanto te llegan acá y por Telegram.'
    return <div className="campana-push"><span>{motivo}</span></div>
  }
  if (estado === 'cargando') return null

  async function alternar() {
    setError(null)
    setOcupado(true)
    try {
      if (estado === 'activo') await desactivarPush()
      else await activarPush(push.clavePublica)
      setEstado(await estadoPush())
    } catch (err) {
      setError(MENSAJE_ERROR[err?.message] || err?.response?.data?.error || 'No se pudo cambiar el aviso en este dispositivo')
      setEstado(await estadoPush())
    } finally {
      setOcupado(false)
    }
  }

  let contenido
  if (estado === 'no_soportado') {
    contenido = esIosSinInstalar()
      ? <span>En iPhone, instalá Cashy en la pantalla de inicio (Compartir → Agregar a inicio) para recibir avisos con la app cerrada.</span>
      : <span>Este navegador no permite avisos con la app cerrada.</span>
  } else if (estado === 'bloqueado') {
    contenido = <span>Bloqueaste los avisos para este sitio. Habilitalos desde la configuración del navegador.</span>
  } else {
    contenido = (
      <>
        <span>{estado === 'activo' ? '🔔 Avisos con la app cerrada: activados en este dispositivo' : 'Recibí avisos aunque tengas la app cerrada'}</span>
        <button type="button" className="btn-secondary campana-push-btn" onClick={alternar} disabled={ocupado}>
          {ocupado ? '…' : estado === 'activo' ? 'Desactivar' : 'Activar'}
        </button>
      </>
    )
  }

  return (
    <div className="campana-push">
      {contenido}
      {error && <div className="campana-push-error">{error}</div>}
    </div>
  )
}

export default function CampanaNotificaciones() {
  const { lista, noLeidas, push, marcarLeidas } = useNotificaciones()
  const navigate = useNavigate()
  const [abierto, setAbierto] = useState(false)
  const [sinLeer, setSinLeer] = useState(() => new Set()) // los que estaban sin leer al abrir
  const contenedor = useRef(null)

  useEffect(() => {
    if (!abierto) return undefined
    const alClickear = (e) => { if (contenedor.current && !contenedor.current.contains(e.target)) setAbierto(false) }
    const alTeclear = (e) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', alClickear)
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('mousedown', alClickear)
      document.removeEventListener('keydown', alTeclear)
    }
  }, [abierto])

  function alternar() {
    if (!abierto) {
      // Se recuerda cuáles eran nuevas para resaltarlas, y recién ahí se marcan como leídas.
      setSinLeer(new Set(lista.filter(n => !n.leida).map(n => n.id)))
      if (noLeidas > 0) marcarLeidas()
    }
    setAbierto(a => !a)
  }

  function abrirAviso(n) {
    setAbierto(false)
    if (n.url) navigate(n.url)
  }

  return (
    <div className="campana" ref={contenedor}>
      <button
        type="button"
        className="campana-btn"
        onClick={alternar}
        aria-label={noLeidas > 0 ? `Notificaciones: ${noLeidas} sin leer` : 'Notificaciones'}
        aria-expanded={abierto}
        title="Notificaciones"
      >
        🔔
        {noLeidas > 0 && <span className="campana-badge">{noLeidas > 9 ? '9+' : noLeidas}</span>}
      </button>

      {abierto && (
        <div className="campana-panel" role="dialog" aria-label="Notificaciones">
          <div className="campana-titulo">Notificaciones</div>
          {lista.length === 0 ? (
            <div className="campana-vacio">
              Todavía no tenés avisos. Acá vas a ver cuando llegue un paciente o cambie un turno tuyo.{' '}
              <button type="button" className="btn-link-inline" onClick={() => { setAbierto(false); navigate('/config?tab=profesionales') }}>
                ¿Sos profesional? Registrate para recibirlos
              </button>
            </div>
          ) : (
            <ul className="campana-lista">
              {lista.map(n => (
                <li key={n.id}>
                  <button type="button" className={`campana-item${sinLeer.has(n.id) ? ' nueva' : ''}`} onClick={() => abrirAviso(n)}>
                    <span className="campana-item-titulo">{n.titulo}</span>
                    {n.cuerpo && <span className="campana-item-cuerpo">{n.cuerpo}</span>}
                    <span className="campana-item-hora">{hace(n.creadaEn)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <SeccionPush push={push} />
        </div>
      )}
    </div>
  )
}
