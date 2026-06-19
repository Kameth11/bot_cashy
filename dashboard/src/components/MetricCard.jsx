import { useState, useRef, useEffect } from 'react'

const SIMBOLOS = { Dólares: 'U$S', Euros: '€', Pesos: '$' }

function formatMontoMoneda(moneda, monto) {
  const abs  = Math.abs(monto)
  const sign = monto < 0 ? '-' : ''
  if (moneda === 'Pesos') return `${sign}$${abs.toLocaleString('es-AR')}`
  const sim = SIMBOLOS[moneda] ?? moneda
  return `${sign}${sim} ${abs.toLocaleString('es-AR')}`
}

function formatFechaCorta(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}

export default function MetricCard({ label, value, subtitle, variant = 'default', breakdown, items }) {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const cardRef = useRef(null)

  const currencies   = breakdown ? Object.keys(breakdown) : []
  const hasBreakdown = currencies.length >= 1
  const hasItems     = Array.isArray(items) && items.length > 0
  const hasPopover    = hasBreakdown || hasItems
  const showPopover   = (hovered || pinned) && hasPopover

  // En touch no existe "mouseleave", asi que un tap afuera de la card
  // cierra el popover que quedo fijado por un tap previo.
  useEffect(() => {
    if (!pinned) return
    function onDocClick(e) {
      if (cardRef.current && !cardRef.current.contains(e.target)) setPinned(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [pinned])

  return (
    <div
      ref={cardRef}
      className={`metric-card metric-${variant}`}
      style={{ position: 'relative', cursor: hasPopover ? 'pointer' : 'default' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => hasPopover && setPinned(p => !p)}
    >
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      {subtitle && <p className="metric-sub">{subtitle}</p>}

      {hasPopover && (
        <span style={{ position: 'absolute', top: 14, right: 14, fontSize: 10, color: 'var(--text-3)', userSelect: 'none' }}>
          ···
        </span>
      )}

      {showPopover && hasBreakdown && (
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

      {showPopover && hasItems && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
          background: '#172B4D', color: '#f1f5f9', borderRadius: 8,
          padding: '10px 14px', minWidth: 240, maxWidth: 320, maxHeight: 280, overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(9,30,66,0.22)', fontSize: 13, lineHeight: 1.5,
        }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Movimientos pendientes
          </p>
          {items.map((m, i) => (
            <div key={m.idUnico ?? i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingBottom: 6 }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ color: '#8993A4', fontSize: 11, marginRight: 6 }}>{formatFechaCorta(m.fecha)}</span>
                {m.descripcion || m.paciente || m.proveedor || 'Sin descripción'}
              </span>
              <span style={{ fontWeight: 600, flexShrink: 0 }}>
                {formatMontoMoneda(m.moneda || 'Pesos', Math.abs(Number(m.monto || 0)))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
