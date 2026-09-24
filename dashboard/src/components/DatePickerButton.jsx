import { Calendar } from 'lucide-react'

// Botón con ícono de calendario que abre el date picker nativo del navegador.
// El <input type="date"> recibe el tap directamente (superpuesto, invisible):
// en iOS/iPadOS Safari el picker nativo solo se abre con un gesto real del
// usuario sobre el input, no vía .focus()/.showPicker() disparado desde JS.
export default function DatePickerButton({ value, onChange, title = 'Elegir fecha', className = 'btn-agenda' }) {
  return (
    <div style={{ position: 'relative', display: 'inline-flex', overflow: 'hidden' }}>
      <button type="button" className={className} title={title} tabIndex={-1} style={{ pointerEvents: 'none' }}>
        <Calendar size={14} />
      </button>
      <input
        type="date"
        value={value || ''}
        title={title}
        onChange={e => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', border: 0, padding: 0, margin: 0 }}
      />
    </div>
  )
}
