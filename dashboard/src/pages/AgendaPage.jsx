import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'

const HORA_INICIO = 8
const HORA_FIN = 21
const INTERVALO = 30

const ESTADOS = {
  Pendiente: { label: 'Pendiente', bg: '#FFF4CE', color: '#FF8B00',  bar: '#FF8B00'  },
  'Llegó':   { label: 'Llegó',    bg: '#DEEBFF', color: '#0747A6',  bar: '#0747A6'  },
  Cobrado:   { label: 'Cobrado',  bg: '#E3FCEF', color: '#006644',  bar: '#006644'  },
  Cancelado: { label: 'Cancelado',bg: '#FFEBE6', color: '#BF2600',  bar: '#BF2600'  },
}

function generarSlots() {
  const slots = []
  for (let h = HORA_INICIO; h < HORA_FIN; h++) {
    for (let m = 0; m < 60; m += INTERVALO) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return slots
}

const SLOTS = generarSlots()

function turnoParaSlot(turnos, slot) {
  return turnos.find(t => {
    if (!t.hora) return false
    const hora = t.hora.trim().substring(0, 5)
    return hora === slot
  })
}

export default function AgendaPage() {
  const [turnos, setTurnos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalTurno, setModalTurno] = useState(null)
  const [monto, setMonto] = useState('')
  const [metodoPago, setMetodoPago] = useState('efectivo')
  const [guardando, setGuardando] = useState(false)
  const [accionando, setAccionando] = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/api/agenda')
      setTurnos(data.turnos || [])
    } catch {
      setError('No se pudo cargar la agenda. ¿Está corriendo el servidor?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function handleLlego(turno) {
    setAccionando(turno.idTurno)
    try {
      await api.post(`/api/agenda/${turno.idTurno}/llego`)
      setTurnos(prev => prev.map(t =>
        t.idTurno === turno.idTurno ? { ...t, estado: 'Llegó' } : t
      ))
    } catch {
      alert('Error al registrar llegada')
    } finally {
      setAccionando(null)
    }
  }

  async function confirmarCobro() {
    if (!monto || isNaN(Number(monto)) || Number(monto) <= 0) {
      alert('Ingresá un monto válido')
      return
    }
    setGuardando(true)
    try {
      await api.patch(`/api/agenda/${modalTurno.idTurno}/cobrado`, {
        monto: Number(monto),
        metodoPago,
        moneda: 'Pesos',
      })
      setTurnos(prev => prev.map(t =>
        t.idTurno === modalTurno.idTurno ? { ...t, estado: 'Cobrado' } : t
      ))
      setModalTurno(null)
    } catch {
      alert('Error al registrar cobro')
    } finally {
      setGuardando(false)
    }
  }

  const hoy = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long'
  })

  const turnosConTurno = turnos.filter(t => t.estado !== 'Cancelado')
  const cobrados   = turnosConTurno.filter(t => t.estado === 'Cobrado').length
  const llegaron   = turnosConTurno.filter(t => t.estado === 'Llegó').length
  const pendientes = turnosConTurno.filter(t => t.estado === 'Pendiente').length

  // List view: only slots that have a turno, in order
  const turnosList = SLOTS
    .map(slot => ({ slot, turno: turnoParaSlot(turnos, slot) }))
    .filter(({ turno }) => turno)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Agenda</h1>
          <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>{hoy}</p>
        </div>
        <button className="btn-agenda" onClick={cargar}>Actualizar</button>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Summary chips */}
      {!loading && turnos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            ['Pendientes', pendientes, 'Pendiente'],
            ['Llegaron',   llegaron,   'Llegó'],
            ['Cobrados',   cobrados,   'Cobrado'],
          ].map(([label, count, estado]) => {
            const e = ESTADOS[estado] || ESTADOS.Pendiente
            return (
              <span key={label} className="agenda-badge" style={{ background: e.bg, color: e.color }}>
                {count} {label}
              </span>
            )
          })}
        </div>
      )}

      {/* Appointment list */}
      <div className="card-surface">
        {loading && <div className="empty-state">Cargando…</div>}

        {!loading && turnosList.length === 0 && !error && (
          <div className="empty-state">
            Sin turnos hoy. Enviá una foto de la agenda al bot para cargarlos.
          </div>
        )}

        {!loading && turnosList.map(({ slot, turno }, i) => {
          const e = ESTADOS[turno.estado] || ESTADOS.Pendiente
          const puedeAccion = turno.estado !== 'Cobrado' && turno.estado !== 'Cancelado'
          return (
            <div key={slot} className="agenda-appt">
              <span className="agenda-time">{slot}</span>
              <div className="agenda-bar" style={{ background: e.bar }} />
              <div className="agenda-info">
                <div className="agenda-patient">{turno.cliente || 'Sin nombre'}</div>
                {(turno.servicio || turno.profesional) && (
                  <div className="agenda-treat">
                    {[turno.servicio, turno.profesional].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <span className="agenda-badge" style={{ background: e.bg, color: e.color, marginRight: 8 }}>
                {e.label}
              </span>
              {puedeAccion && (
                <div style={{ display: 'flex', gap: 4 }}>
                  {turno.estado !== 'Llegó' && (
                    <button
                      className="btn-agenda"
                      disabled={accionando === turno.idTurno}
                      onClick={() => handleLlego(turno)}
                    >
                      {accionando === turno.idTurno ? '…' : 'Llegó'}
                    </button>
                  )}
                  <button
                    className="btn-agenda primary"
                    disabled={accionando === turno.idTurno}
                    onClick={() => { setModalTurno(turno); setMonto(''); setMetodoPago('efectivo') }}
                  >
                    Cobrar
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Cobro modal */}
      {modalTurno && (
        <div className="overlay" onClick={() => setModalTurno(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title" style={{ fontSize: 16 }}>Registrar cobro</h2>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>
              <strong>{modalTurno.cliente}</strong>
              {modalTurno.hora ? ` · ${modalTurno.hora}hs` : ''}
              {modalTurno.servicio ? ` · ${modalTurno.servicio}` : ''}
            </p>
            <div className="modal-form">
              <div>
                <label className="form-label">Monto ($)</label>
                <input
                  className="form-input"
                  type="number"
                  placeholder="15000"
                  value={monto}
                  onChange={e => setMonto(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && confirmarCobro()}
                  autoFocus
                />
              </div>
              <div>
                <label className="form-label">Método de pago</label>
                <select className="form-input" value={metodoPago} onChange={e => setMetodoPago(e.target.value)}>
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="tarjeta">Tarjeta</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setModalTurno(null)}>Cancelar</button>
              <button className="btn-primary" onClick={confirmarCobro} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Confirmar cobro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
