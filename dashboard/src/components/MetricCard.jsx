import { useState } from 'react'

const SIMBOLOS = { Dólares: 'U$S', Euros: '€', Pesos: '$' }

function formatMontoMoneda(moneda, monto) {
  const abs = Math.abs(monto)
  const sign = monto < 0 ? '-' : ''
  if (moneda === 'Pesos') return `${sign}$${abs.toLocaleString('es-AR')}`
  const sim = SIMBOLOS[moneda] ?? moneda
  return `${sign}${sim} ${abs.toLocaleString('es-AR')}`
}

export default function MetricCard({ label, value, subtitle, variant = 'default', breakdown }) {
  const [hovered, setHovered] = useState(false)

  const currencies = breakdown ? Object.keys(breakdown) : []
  const hasMultiple = currencies.length > 1

  return (
    <div
      className={`metric-card metric-${variant}`}
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      {subtitle && <p className="metric-sub">{subtitle}</p>}

      {hasMultiple && (
        <span style={{
          position: 'absolute',
          top: '14px',
          right: '14px',
          fontSize: '10px',
          color: '#94a3b8',
          cursor: 'default',
          userSelect: 'none',
        }}>
          ···
        </span>
      )}

      {hovered && hasMultiple && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          zIndex: 50,
          background: '#1e293b',
          color: '#f1f5f9',
          borderRadius: '10px',
          padding: '10px 14px',
          minWidth: '200px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          fontSize: '13px',
          lineHeight: '1.6',
        }}>
          <p style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
            Desglose por moneda
          </p>
          {currencies.map(moneda => {
            const { monto, montoPesos } = breakdown[moneda]
            const esExtranjera = moneda !== 'Pesos'
            return (
              <div key={moneda} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', paddingBottom: '2px' }}>
                <span style={{ color: '#94a3b8', flexShrink: 0 }}>{moneda}</span>
                <span style={{ textAlign: 'right' }}>
                  <span style={{ fontWeight: 600 }}>{formatMontoMoneda(moneda, monto)}</span>
                  {esExtranjera && (
                    <span style={{ color: '#64748b', marginLeft: '6px', fontSize: '11px' }}>
                      ≈ ${Math.abs(montoPesos).toLocaleString('es-AR')}
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
