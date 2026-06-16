import { useState } from 'react'

const SIMBOLOS = { Dólares: 'U$S', Euros: '€', Pesos: '$' }

function formatMontoMoneda(moneda, monto) {
  const abs  = Math.abs(monto)
  const sign = monto < 0 ? '-' : ''
  if (moneda === 'Pesos') return `${sign}$${abs.toLocaleString('es-AR')}`
  const sim = SIMBOLOS[moneda] ?? moneda
  return `${sign}${sim} ${abs.toLocaleString('es-AR')}`
}

export default function MetricCard({ label, value, subtitle, variant = 'default', breakdown }) {
  const [hovered, setHovered] = useState(false)

  const currencies  = breakdown ? Object.keys(breakdown) : []
  const hasMultiple = currencies.length > 1

  return (
    <div
      className={`metric-card metric-${variant}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      {subtitle && <p className="metric-sub">{subtitle}</p>}

      {hasMultiple && (
        <span style={{ position: 'absolute', top: 14, right: 14, fontSize: 10, color: 'var(--text-3)', userSelect: 'none' }}>
          ···
        </span>
      )}

      {hovered && hasMultiple && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
          background: '#172B4D', color: '#f1f5f9', borderRadius: 8,
          padding: '10px 14px', minWidth: 200,
          boxShadow: '0 8px 24px rgba(9,30,66,0.22)', fontSize: 13, lineHeight: 1.6,
        }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Desglose por moneda
          </p>
          {currencies.map(moneda => {
            const { monto, montoPesos } = breakdown[moneda]
            const esExtranjera = moneda !== 'Pesos'
            return (
              <div key={moneda} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, paddingBottom: 2 }}>
                <span style={{ color: '#8993A4', flexShrink: 0 }}>{moneda}</span>
                <span style={{ textAlign: 'right' }}>
                  <span style={{ fontWeight: 600 }}>{formatMontoMoneda(moneda, monto)}</span>
                  {esExtranjera && (
                    <span style={{ color: '#5E6C84', marginLeft: 6, fontSize: 11 }}>
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
