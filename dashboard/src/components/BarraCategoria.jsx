import { formatPesos } from '../utils/format'

// Barra horizontal en CSS: el proyecto no tiene librería de charts y para esto
// no hace falta sumar una dependencia.
export default function BarraCategoria({ label, monto, porcentaje, color = 'var(--primary)' }) {
  return (
    <div className="pers-bar-row">
      <div className="pers-bar-head">
        <span className="pers-bar-label">{label}</span>
        <span className="pers-bar-value">{formatPesos(monto)}</span>
      </div>
      <div className="pers-bar-track">
        <div
          className="pers-bar-fill"
          style={{ width: `${Math.min(porcentaje, 100)}%`, background: color }}
        />
      </div>
      <span className="pers-bar-pct">{porcentaje}%</span>
    </div>
  )
}
