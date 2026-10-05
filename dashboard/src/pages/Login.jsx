import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { useAuth } from '../hooks/useAuth'
import { useLoginTelegram } from '../hooks/useLoginTelegram'
import { useGoogleLogin } from '../hooks/useGoogleLogin'
import { api } from '../services/api'

const ULTIMO_ID_KEY = 'cashy_last_id'

// localStorage puede no estar disponible (modo privado, datos bloqueados): la pantalla
// tiene que funcionar igual.
function leerUltimoId() {
  try { return localStorage.getItem(ULTIMO_ID_KEY) || '' } catch { return '' }
}
function guardarUltimoId(id) {
  try { localStorage.setItem(ULTIMO_ID_KEY, id) } catch { /* sin persistencia */ }
}

const estilos = {
  boton: {
    display: 'block', width: '100%', padding: '14px', boxSizing: 'border-box', textAlign: 'center',
    background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', color: '#fff', border: 'none',
    borderRadius: '10px', fontSize: '16px', fontWeight: 600, textDecoration: 'none', cursor: 'pointer',
  },
  botonSecundario: {
    display: 'block', width: '100%', padding: '12px', boxSizing: 'border-box', textAlign: 'center',
    background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '10px',
    fontSize: '14px', fontWeight: 600, cursor: 'pointer',
  },
  link: {
    background: 'none', border: 'none', color: '#6366f1', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', padding: 0, textDecoration: 'underline',
  },
  input: {
    width: '100%', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '10px', fontSize: '16px', boxSizing: 'border-box',
  },
  etiqueta: { display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '8px', color: '#374151' },
  error: {
    background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '12px',
    borderRadius: '10px', marginBottom: '20px', fontSize: '14px',
  },
  nota: { textAlign: 'center', color: '#64748b', fontSize: '13px', marginTop: '16px' },
}

function formatoTiempo(seg) {
  const m = Math.floor(seg / 60)
  return `${m}:${String(seg % 60).padStart(2, '0')}`
}

function LoginTelegram({ onSesion, onUsarCodigo, previo = null, emailGoogle = null }) {
  const { estado, deepLink, restante, error, iniciar, consultarYa } = useLoginTelegram(onSesion)

  // La solicitud se crea al mostrar la pantalla: así el enlace ya está listo y el
  // toque de la persona abre Telegram sin que el navegador lo bloquee.
  useEffect(() => { iniciar(previo) }, [iniciar, previo])

  if (estado === 'iniciando') {
    return <p style={{ textAlign: 'center', color: '#64748b' }}>Preparando el ingreso…</p>
  }

  if (estado !== 'esperando') {
    const mensajes = {
      vencida: 'El pedido venció. Generá uno nuevo.',
      rechazada: 'Rechazaste el ingreso. Si querés entrar, probá de nuevo.',
      error: error || 'No se pudo iniciar el ingreso con Telegram.',
    }
    return (
      <>
        <div style={estilos.error}>{mensajes[estado]}</div>
        <button type="button" style={estilos.boton} onClick={iniciar}>Probar de nuevo</button>
        <p style={estilos.nota}>
          <button type="button" style={estilos.link} onClick={onUsarCodigo}>Usar un código de 6 dígitos</button>
        </p>
      </>
    )
  }

  return (
    <>
      {emailGoogle && (
        <p style={{ ...estilos.nota, marginTop: 0, marginBottom: '16px', color: '#374151' }}>
          Es la primera vez que entrás con <strong>{emailGoogle}</strong>. Confirmá en Telegram que esa
          cuenta de Google es tuya para vincularla a tu Cashy.
        </p>
      )}
      <a href={deepLink} target="_blank" rel="noopener noreferrer" style={estilos.boton}>
        📲 Abrir Telegram y confirmar
      </a>

      <div style={{ textAlign: 'center', marginTop: '22px' }}>
        <div style={{ display: 'inline-block', padding: '12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px' }}>
          <QRCodeSVG value={deepLink} size={168} />
        </div>
        <p style={{ color: '#64748b', fontSize: '13px', margin: '10px 0 0' }}>
          ¿Telegram está en otro dispositivo? Escaneá este código con el celular
        </p>
      </div>

      <p style={{ ...estilos.nota, marginTop: '22px' }}>
        Esperando tu confirmación en Telegram… <strong>{formatoTiempo(restante)}</strong>
        <br />
        <button type="button" style={{ ...estilos.link, marginTop: '8px' }} onClick={consultarYa}>Ya confirmé</button>
      </p>
      {onUsarCodigo && (
        <p style={estilos.nota}>
          <button type="button" style={estilos.link} onClick={onUsarCodigo}>Prefiero usar un código de 6 dígitos</button>
        </p>
      )}
    </>
  )
}

// "Entrar con Google": el botón oficial de Google más el manejo de lo que responde el
// servidor. Si la cuenta de Google ya está vinculada entra directo; si no, devuelve un
// pedido de vínculo que se confirma en Telegram (`onVincular`).
function BotonGoogle({ onSesion, onVincular }) {
  const [error, setError] = useState('')
  const contenedor = useRef(null)

  const alCredencial = useCallback(async (credential) => {
    setError('')
    try {
      const { data } = await api.post('/api/auth/google', { credential })
      if (data.estado === 'aprobada') return await onSesion(data)
      if (data.estado === 'vincular') return onVincular(data)
      setError({
        email_no_verificado: 'Esa cuenta de Google no tiene el email verificado.',
        rechazada: 'Esa cuenta ya no tiene acceso a Cashy.',
        no_disponible: 'El ingreso con Google no está disponible ahora.',
      }[data.estado] || 'No se pudo validar tu cuenta de Google. Probá de nuevo.')
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudo completar el ingreso con Google.')
    }
  }, [onSesion, onVincular])

  const { disponible, renderBoton } = useGoogleLogin(alCredencial)

  useEffect(() => { if (disponible) renderBoton(contenedor.current) }, [disponible]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!disponible) return null
  return (
    <div style={{ marginTop: '20px' }}>
      <p style={{ ...estilos.nota, margin: '0 0 12px' }}>o</p>
      <div ref={contenedor} style={{ display: 'flex', justifyContent: 'center' }} />
      {error && <div style={{ ...estilos.error, marginTop: '12px', marginBottom: 0 }}>{error}</div>}
    </div>
  )
}

function LoginCodigo({ login, requestCode, onNavegar, onUsarTelegram }) {
  const [telegramId, setTelegramId] = useState(leerUltimoId)
  const [codigo, setCodigo] = useState('')
  const [paso, setPaso] = useState('id')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [reenviarEn, setReenviarEn] = useState(0)

  useEffect(() => {
    if (reenviarEn <= 0) return undefined
    const t = setTimeout(() => setReenviarEn(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [reenviarEn])

  async function pedirCodigo(e) {
    if (e) e.preventDefault()
    setError('')
    const id = telegramId.trim()
    if (!id) {
      setError('Ingresá tu ID de Telegram')
      return
    }
    setLoading(true)
    try {
      await requestCode(id)
      guardarUltimoId(id)
      setPaso('codigo')
      setReenviarEn(30)
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudo enviar el código')
    } finally {
      setLoading(false)
    }
  }

  async function verificar(valor) {
    setError('')
    setLoading(true)
    try {
      await login(telegramId.trim(), valor)
      onNavegar()
    } catch (err) {
      setError(err?.response?.data?.error || 'Código inválido')
      setCodigo('')
    } finally {
      setLoading(false)
    }
  }

  function cambiarCodigo(e) {
    const valor = e.target.value.replace(/\D/g, '').slice(0, 6)
    setCodigo(valor)
    // Al completar los 6 dígitos se envía solo.
    if (valor.length === 6 && !loading) verificar(valor)
  }

  return (
    <form onSubmit={paso === 'codigo' ? (e) => { e.preventDefault(); if (codigo.length === 6) verificar(codigo) } : pedirCodigo}>
      <div style={{ marginBottom: '20px' }}>
        <label style={estilos.etiqueta}>ID de Telegram</label>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="username"
          value={telegramId}
          onChange={(e) => setTelegramId(e.target.value)}
          placeholder="Ej: 123456789"
          disabled={paso === 'codigo'}
          style={{ ...estilos.input, opacity: paso === 'codigo' ? 0.6 : 1 }}
        />
      </div>

      {paso === 'codigo' && (
        <div style={{ marginBottom: '20px' }}>
          <label style={estilos.etiqueta}>Código recibido en Telegram</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={codigo}
            onChange={cambiarCodigo}
            placeholder="123456"
            maxLength={6}
            autoFocus
            style={{ ...estilos.input, letterSpacing: '2px', textAlign: 'center' }}
          />
        </div>
      )}

      {error && <div style={estilos.error}>{error}</div>}

      <button type="submit" disabled={loading} style={{ ...estilos.boton, opacity: loading ? 0.7 : 1 }}>
        {paso === 'id' ? 'Enviar código' : 'Ingresar'}
      </button>

      {paso === 'codigo' && (
        <p style={estilos.nota}>
          {reenviarEn > 0
            ? `Podés pedir otro código en ${reenviarEn} s`
            : <button type="button" style={estilos.link} onClick={() => pedirCodigo()}>Reenviar código</button>}
        </p>
      )}

      <p style={estilos.nota}>
        {paso === 'id'
          ? 'Te enviaremos un código de 6 dígitos a tu Telegram'
          : 'Escribí /start al bot si no lo tenés iniciado'}
      </p>
      <p style={estilos.nota}>
        <button type="button" style={estilos.link} onClick={onUsarTelegram}>Entrar con Telegram sin código</button>
      </p>
    </form>
  )
}

function Login() {
  const { login, loginConSesion, requestCode, loginDemo } = useAuth()
  const navigate = useNavigate()
  const [modo, setModo] = useState('telegram')
  const [demo, setDemo] = useState(false)
  const [vinculo, setVinculo] = useState(null) // pedido de vínculo de Google

  const irAlInicio = () => navigate('/', { replace: true })

  async function alAprobarse(sesion) {
    await loginConSesion(sesion)
    irAlInicio()
  }

  function entrarDemo() {
    setDemo(true)
    loginDemo()
    irAlInicio()
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
      padding: '20px'
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '20px',
        padding: '40px',
        width: '100%',
        maxWidth: '400px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{
            fontSize: '32px',
            fontWeight: 800,
            background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            marginBottom: '8px'
          }}>
            Cashy
          </h1>
          <p style={{ color: '#64748b', fontSize: '14px' }}>
            Panel de gestión - Consultorio Odontológico
          </p>
        </div>

        {demo ? (
          <p style={{ textAlign: 'center', color: '#10b981', fontWeight: 700 }}>Entrando en modo demo...</p>
        ) : vinculo ? (
          <>
            <LoginTelegram onSesion={alAprobarse} previo={vinculo} emailGoogle={vinculo.email} />
            <p style={estilos.nota}>
              <button type="button" style={estilos.link} onClick={() => setVinculo(null)}>Cancelar</button>
            </p>
          </>
        ) : (
          <>
            {modo === 'telegram' ? (
              <LoginTelegram onSesion={alAprobarse} onUsarCodigo={() => setModo('codigo')} />
            ) : (
              <LoginCodigo
                login={login}
                requestCode={requestCode}
                onNavegar={irAlInicio}
                onUsarTelegram={() => setModo('telegram')}
              />
            )}
            <BotonGoogle onSesion={alAprobarse} onVincular={setVinculo} />
          </>
        )}

        <button type="button" onClick={entrarDemo} style={{ ...estilos.botonSecundario, marginTop: '16px' }}>
          Entrar sin Telegram
        </button>
      </div>
    </div>
  )
}

export default Login
