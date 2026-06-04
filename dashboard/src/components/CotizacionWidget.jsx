import { useState, useEffect } from 'react'
import { api } from '../services/api'

export default function CotizacionWidget() {
  const [data, setData] = useState(null)

  async function fetchCotizacion() {
    try {
      const res = await api.get('/api/cotizacion')
      setData(res.data)
    } catch {
      // silencioso — no bloquear el dashboard si falla
    }
  }

  useEffect(() => {
    fetchCotizacion()
    const timer = setInterval(fetchCotizacion, 30 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  if (!data?.dolar && !data?.euro) return null

  const fecha = data.fecha ? new Date(data.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : null

  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      marginBottom: '24px',
      flexWrap: 'wrap',
    }}>
      {data.dolar && (
        <div style={cardStyle('#f0fdf4', '#16a34a')}>
          <span style={labelStyle}>USD blue</span>
          <span style={valueStyle}>${data.dolar.toLocaleString('es-AR')}</span>
        </div>
      )}
      {data.euro && (
        <div style={cardStyle('#eff6ff', '#2563eb')}>
          <span style={labelStyle}>EUR blue</span>
          <span style={valueStyle}>${data.euro.toLocaleString('es-AR')}</span>
        </div>
      )}
      {fecha && (
        <div style={{ alignSelf: 'center', fontSize: '11px', color: '#94a3b8' }}>
          Actualizado {fecha}
        </div>
      )}
    </div>
  )
}

const cardStyle = (bg, color) => ({
  background: bg,
  border: `1px solid ${color}30`,
  borderRadius: '10px',
  padding: '10px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  minWidth: '120px',
})

const labelStyle = {
  fontSize: '11px',
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const valueStyle = {
  fontSize: '20px',
  fontWeight: 800,
  color: '#1f2937',
}
