import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'

// Tarjeta de Configuración para cuentas nacidas en la web (invitación por email): no tienen Telegram.
// "Vincular Telegram" abre el bot con una confirmación; al confirmar, ese Telegram queda ligado a esta
// cuenta (puede usar el bot y recibe los avisos ahí). Las cuentas de Telegram no ven esta tarjeta.

const mensajeDe = (err, porDefecto) => err?.response?.data?.error || porDefecto
const CADA_MS = 3000

export default function TelegramVinculo() {
  const [estado, setEstado] = useState(null)         // { aplica, vinculado, soportado }
  const [enlace, setEnlace] = useState(null)         // { deepLink, expiraEnSeg } mientras se espera la confirmación
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let activo = true
    api.get('/api/telegram/estado').then(res => { if (activo) setEstado(res.data) }).catch(() => {})
    return () => { activo = false }
  }, [])

  // Mientras se espera que confirme en Telegram, se mira cada tanto si ya quedó vinculado.
  useEffect(() => {
    if (!enlace) return undefined
    let activo = true
    const id = setInterval(() => {
      api.get('/api/telegram/estado').then(res => {
        if (!activo) return
        setEstado(res.data)
        if (res.data.vinculado) setEnlace(null)
      }).catch(() => {})
    }, CADA_MS)
    const vence = setTimeout(() => { if (activo) setEnlace(null) }, (enlace.expiraEnSeg || 600) * 1000)
    return () => { activo = false; clearInterval(id); clearTimeout(vence) }
  }, [enlace])

  const vincular = useCallback(async () => {
    setError(null)
    setOcupado(true)
    try {
      const { data } = await api.post('/api/telegram/vincular')
      setEnlace(data)
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo preparar el enlace a Telegram'))
    } finally {
      setOcupado(false)
    }
  }, [])

  const desvincular = useCallback(async () => {
    if (!window.confirm('¿Desvincular tu Telegram? El bot va a dejar de reconocerte y los avisos vuelven a llegar solo por la web.')) return
    setError(null)
    setOcupado(true)
    try {
      await api.delete('/api/telegram/vincular')
      setEstado(e => ({ ...e, vinculado: false }))
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo desvincular Telegram'))
    } finally {
      setOcupado(false)
    }
  }, [])

  if (!estado || !estado.aplica) return null

  return (
    <div className="config-card">
      <div className="config-card-header"><h2>Telegram</h2></div>
      <div className="config-card-body">
        {estado.vinculado ? (
          <>
            <p style={{ fontSize: 13.5, margin: '0 0 6px' }}>
              <span style={{ color: '#36B37E', fontWeight: 600 }}>● Vinculado.</span> Podés usar el bot con tu cuenta y los avisos de tus turnos te llegan también por Telegram.
            </p>
            <button type="button" className="btn-secondary" style={{ fontSize: 13 }} onClick={desvincular} disabled={ocupado}>
              Desvincular Telegram
            </button>
          </>
        ) : !estado.soportado ? (
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
            Vincular Telegram todavía no está habilitado en el servidor (falta correr la migración 022).
          </p>
        ) : enlace ? (
          <>
            <p style={{ fontSize: 13.5, margin: '0 0 10px', lineHeight: 1.5 }}>
              Abrí Telegram con este botón y tocá <strong>“Sí, vincular”</strong>. Esta pantalla se actualiza sola cuando termines.
            </p>
            <a className="btn-primary" style={{ display: 'inline-block', textDecoration: 'none', fontSize: 13 }} href={enlace.deepLink} target="_blank" rel="noreferrer">
              Abrir Telegram
            </a>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '10px 0 0' }}>
              El enlace vale {Math.round((enlace.expiraEnSeg || 600) / 60)} minutos. Hacelo solo vos, desde tu propio Telegram.
            </p>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13.5, margin: '0 0 10px', lineHeight: 1.5 }}>
              Tu cuenta no tiene Telegram. Si lo vinculás, podés usar el bot (cargar gastos por mensaje o audio, consultar la agenda) y recibís ahí los avisos de tus turnos.
            </p>
            <button type="button" className="btn-primary" style={{ fontSize: 13 }} onClick={vincular} disabled={ocupado}>
              {ocupado ? 'Preparando…' : 'Vincular Telegram'}
            </button>
          </>
        )}
        {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
      </div>
    </div>
  )
}
