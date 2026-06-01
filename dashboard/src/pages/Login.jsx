import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

function Login() {
  const { login, requestCode, loginDemo } = useAuth()
  const navigate = useNavigate()
  const [telegramId, setTelegramId] = useState('')
  const [codigo, setCodigo] = useState('')
  const [paso, setPaso] = useState('id')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [demo, setDemo] = useState(false)

  async function pedirCodigo(e) {
    e.preventDefault()
    setError('')
    if (!telegramId.trim()) {
      setError('Ingrese su ID de Telegram')
      return
    }
    setLoading(true)
    try {
      await requestCode(telegramId.trim())
      setPaso('codigo')
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudo enviar el código')
    } finally {
      setLoading(false)
    }
  }

  async function verificarCodigo(e) {
    e.preventDefault()
    setError('')
    if (!codigo.trim()) {
      setError('Ingrese el código de 6 dígitos')
      return
    }
    setLoading(true)
    try {
      await login(telegramId.trim(), codigo.trim())
      navigate('/', { replace: true })
    } catch (err) {
      setError(err?.response?.data?.error || 'Código inválido')
    } finally {
      setLoading(false)
    }
  }

  function entrarDemo() {
    setDemo(true)
    loginDemo()
    navigate('/', { replace: true })
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

        {!demo ? (
          <form onSubmit={paso === 'codigo' ? verificarCodigo : pedirCodigo}>
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: 600,
                marginBottom: '8px',
                color: '#374151'
              }}>
                ID de Telegram
              </label>
              <input
                type="text"
                value={telegramId}
                onChange={(e) => setTelegramId(e.target.value)}
                placeholder="Ej: 123456789"
                disabled={paso === 'codigo'}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '10px',
                  fontSize: '16px',
                  opacity: paso === 'codigo' ? 0.6 : 1
                }}
              />
            </div>

            {paso === 'codigo' && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 600,
                  marginBottom: '8px',
                  color: '#374151'
                }}>
                  Código recibido en Telegram
                </label>
                <input
                  type="text"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  maxLength={6}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '10px',
                    fontSize: '16px',
                    letterSpacing: '2px',
                    textAlign: 'center'
                  }}
                />
              </div>
            )}

            {error && (
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                padding: '12px',
                borderRadius: '10px',
                marginBottom: '20px',
                fontSize: '14px'
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px',
                background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                fontSize: '16px',
                fontWeight: 600,
                opacity: loading ? 0.7 : 1
              }}
            >
              {paso === 'id' ? 'Enviar código' : 'Ingresar'}
            </button>
          </form>
        ) : (
          <p style={{ textAlign: 'center', color: '#10b981', fontWeight: 700 }}>Entrando en modo demo...</p>
        )}

        <button
          type="button"
          onClick={entrarDemo}
          style={{
            marginTop: '16px',
            width: '100%',
            padding: '12px',
            background: '#fff',
            color: '#374151',
            border: '1px solid #e5e7eb',
            borderRadius: '10px',
            fontSize: '14px',
            fontWeight: 600
          }}
        >
          Entrar sin Telegram
        </button>

        <p style={{
          textAlign: 'center',
          color: '#64748b',
          fontSize: '13px',
          marginTop: '20px'
        }}>
          {paso === 'id'
            ? 'Te enviaremos un código de 6 dígitos a tu Telegram'
            : 'Escribí /start al bot si no lo tenés iniciado'}
        </p>
      </div>
    </div>
  )
}

export default Login
