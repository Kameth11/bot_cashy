import { useState, useEffect, useMemo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { api } from '../services/api'
import MetricCard from '../components/MetricCard'
import PlusButton from '../components/PlusButton'

function Dashboard() {
  const [filtro, setFiltro] = useState('mes')
  const [movimientos, setMovimientos] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const range = useMemo(() => {
    const now = new Date()
    if (filtro === 'hoy') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      return { desde: start, hasta: now.toISOString() }
    }
    if (filtro === 'semana') {
      const start = new Date(now)
      start.setDate(now.getDate() - now.getDay())
      start.setHours(0, 0, 0, 0)
      return { desde: start.toISOString(), hasta: now.toISOString() }
    }
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    return { desde: start, hasta: now.toISOString() }
  }, [filtro])

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data } = await api.get('/api/movimientos', {
          params: { desde: range.desde, hasta: range.hasta }
        })
        if (!active) return
        setMovimientos(Array.isArray(data?.movimientos) ? data.movimientos : [])
      } catch (err) {
        if (!active) return
        console.error('Dashboard error', err)
        setError('No se pudieron cargar los movimientos')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [range])

  const metricas = useMemo(() => {
    const ingresos = movimientos
      .filter(m => m.tipo?.toLowerCase() === 'ingreso' && m.estado?.toLowerCase() === 'cobrado')
      .reduce((acc, m) => acc + Math.abs(Number(m.monto || 0)), 0)

    const egresos = movimientos
      .filter(m => m.tipo?.toLowerCase() === 'egreso')
      .reduce((acc, m) => acc + Math.abs(Number(m.monto || 0)), 0)

    const pendientes = movimientos.filter(m => m.estado?.toLowerCase() === 'pendiente').length

    return { ingresos, egresos, pendientes, neto: ingresos - egresos }
  }, [movimientos])

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6' }}>
      <header style={{
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 10
      }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1f2937' }}>Dashboard</h1>
          <p style={{ color: '#64748b', fontSize: '13px' }}>
            {filtro === 'hoy' ? 'Hoy' : filtro === 'semana' ? 'Esta semana' : 'Este mes'}
          </p>
        </div>
        <PlusButton onClick={() => alert('Próximamente: nuevo movimiento desde el panel')} />
      </header>

      <main style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>
        {/* Filtros */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {['hoy', 'semana', 'mes'].map((p) => (
            <button
              key={p}
              onClick={() => setFiltro(p)}
              style={{
                padding: '8px 18px',
                borderRadius: '10px',
                border: '1px solid #e5e7eb',
                background: filtro === p ? 'linear-gradient(135deg, #0ea5e9, #6366f1)' : '#fff',
                color: filtro === p ? '#fff' : '#374151',
                fontWeight: 600,
                fontSize: '14px',
                transition: 'background 0.15s',
              }}
            >
              {p === 'hoy' ? 'Hoy' : p === 'semana' ? 'Semana' : 'Mes'}
            </button>
          ))}
        </div>

        {/* Error */}
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

        {/* Métricas */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '28px'
        }}>
          <MetricCard
            label="Ingresos"
            value={`$${metricas.ingresos.toLocaleString('es-AR')}`}
            variant="ingresos"
          />
          <MetricCard
            label="Egresos"
            value={`$${metricas.egresos.toLocaleString('es-AR')}`}
            variant="egresos"
          />
          <MetricCard
            label="Pendientes"
            value={String(metricas.pendientes)}
            variant="pendientes"
          />
          <MetricCard
            label="Neto"
            value={`${metricas.neto < 0 ? '-' : ''}$${Math.abs(metricas.neto).toLocaleString('es-AR')}`}
            variant="neto"
          />
        </div>

        {/* Tabla de movimientos */}
        <div style={{
          background: '#fff',
          borderRadius: '14px',
          border: '1px solid #e5e7eb',
          overflow: 'hidden'
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1f2937' }}>
              Movimientos{' '}
              {loading && <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '14px' }}>(cargando...)</span>}
            </h2>
          </div>

          {!movimientos.length && !loading && (
            <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
              Sin movimientos en este periodo
            </div>
          )}

          {movimientos.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={thStyle}>Fecha</th>
                    <th style={thStyle}>Descripción</th>
                    <th style={thStyle}>Profesional</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Monto</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((mov, index) => (
                    <tr key={mov.id ?? index} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={tdStyle}>{formatFecha(mov.fecha)}</td>
                      <td style={tdStyle}>{mov.descripcion}</td>
                      <td style={{ ...tdStyle, color: '#64748b' }}>{mov.profesional || '-'}</td>
                      <td style={{
                        ...tdStyle,
                        textAlign: 'right',
                        fontWeight: 700,
                        color: mov.tipo?.toLowerCase() === 'ingreso' ? '#10b981' : '#ef4444'
                      }}>
                        {mov.tipo?.toLowerCase() === 'egreso' ? '-' : ''}${Math.abs(Number(mov.monto || 0)).toLocaleString('es-AR')}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <EstadoBadge estado={mov.estado} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function EstadoBadge({ estado }) {
  const cobrado = estado?.toLowerCase() === 'cobrado'
  const color = cobrado ? '#166534' : '#b45309'
  const bg   = cobrado ? '#dcfce7' : '#fef3c7'
  return (
    <span style={{
      display: 'inline-block',
      padding: '4px 10px',
      borderRadius: '999px',
      fontSize: '12px',
      fontWeight: 700,
      background: bg,
      color,
    }}>
      {estado}
    </span>
  )
}

function formatFecha(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return format(d, 'dd/MM/yyyy', { locale: es })
}

const thStyle = {
  padding: '12px 16px',
  textAlign: 'left',
  fontSize: '11px',
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const tdStyle = {
  padding: '14px 16px',
  fontSize: '14px',
  color: '#1f2937',
}

export default Dashboard
