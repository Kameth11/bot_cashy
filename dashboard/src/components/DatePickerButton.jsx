import { useRef } from 'react'
import { Calendar } from 'lucide-react'

// Botón con ícono de calendario que abre el date picker nativo del navegador.
export default function DatePickerButton({ value, onChange, title = 'Elegir fecha', className = 'btn-agenda' }) {
  const inputRef = useRef(null)

  function abrir() {
    const el = inputRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') el.showPicker()
    else el.focus()
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className={className} title={title} onClick={abrir}>
        <Calendar size={14} />
      </button>
      <input
        ref={inputRef}
        type="date"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', border: 0, cursor: 'pointer' }}
      />
    </div>
  )
}
