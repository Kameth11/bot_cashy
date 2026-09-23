import { currencyKey, formatMontoConMoneda } from '../utils/format'

// Primitivas compartidas entre Dashboard, Movimientos y Personal.
// Antes estaban duplicadas verbatim en cada página.

export function CurrencyBadge({ moneda }) {
  const k = currencyKey(moneda)
  return <span className={`badge-cur ${k}`}>{k}</span>
}

export function StatusBadge({ estado }) {
  const key = (estado || '').toLowerCase()
  return <span className={`badge-status ${key}`}>{estado || '—'}</span>
}

export function MontoCell({ mov }) {
  const esEgreso = mov.tipo?.toLowerCase() === 'egreso'
  const moneda   = mov.moneda || 'Pesos'
  const montoStr = formatMontoConMoneda(mov.monto, moneda)
  const absPesos = Math.abs(Number(mov.montoPesos || 0))
  const mostrarEquivalente = moneda !== 'Pesos' && absPesos > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <span className={`mv-monto ${esEgreso ? 'egreso' : 'ingreso'}`}>
        {esEgreso ? '−' : '+'}{montoStr}
      </span>
      {mostrarEquivalente && (
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
          ≈ ${absPesos.toLocaleString('es-AR')}
        </span>
      )}
    </div>
  )
}
