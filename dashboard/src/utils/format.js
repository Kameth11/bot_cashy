import { format } from 'date-fns'
import { es } from 'date-fns/locale'

// El backend manda fechas en DD/MM/YYYY (Sheet) o ISO. `new Date()` no parsea
// el formato del Sheet, así que hay que detectarlo antes.
export function formatFecha(value, pattern = 'dd/MM') {
  if (!value) return '-'

  const ddmmyyyy = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (ddmmyyyy) {
    const [, d, m, a] = ddmmyyyy
    const parsed = new Date(Number(a), Number(m) - 1, Number(d))
    if (!Number.isNaN(parsed.getTime())) return format(parsed, pattern, { locale: es })
  }

  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return format(d, pattern, { locale: es })
}

export function formatPesos(monto) {
  return `$${Math.round(Number(monto) || 0).toLocaleString('es-AR')}`
}

const MONEDA_KEY = { Pesos: 'ARS', 'Dólares': 'USD', Euros: 'EUR' }

export function currencyKey(moneda) {
  return MONEDA_KEY[moneda] || 'ARS'
}

const SIMBOLO = { 'Dólares': 'U$S', Euros: '€' }

export function formatMontoConMoneda(monto, moneda) {
  const abs = Math.abs(Number(monto) || 0)
  const sim = SIMBOLO[moneda]
  return sim ? `${sim} ${abs.toLocaleString('es-AR')}` : `$${abs.toLocaleString('es-AR')}`
}

// Etiqueta legible de una categoría (`comida_afuera` -> `Comida afuera`).
export function etiquetaCategoria(categoria) {
  const texto = String(categoria || '').replace(/_/g, ' ').trim()
  if (!texto) return '—'
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}
