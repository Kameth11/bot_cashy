import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'

const HORA_INICIO = 8
const HORA_FIN = 21
const INTERVALO = 30

const ESTADOS = {
  Pendiente: { label: 'Pendiente', bg: '#fef3c7', color: '#b45309' },
  'Llegó':   { label: 'Llegó',    bg: '#dbeafe', color: '#1d4ed8' },
  Cobrado:   { label: 'Cobrado',  bg: '#dcfce7', color: '#166534' },
  Cancelado: { label: 'Cancelado',bg: '#fee2e2', color: '#b91c1c' },
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

  const turnosHoy = turnos.filter(t => t.estado !== 'Cancelado')
  const cobrados = turnosHoy.filter(t => t.estado === 'Cobrado').length
  const llegaron = turnosHoy.filter(t => t.estado === 'Llegó').length
  const pendientes = turnosHoy.filter(t => t.estado === 'Pendiente').length

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6' }}>
      {/* Header */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        padding: '16px 24px', position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1f2937' }}>Agenda</h1>
          <p style={{ color: '#64748b', fontSize: '13px', textTransform: 'capitalize' }}>{hoy}</p>
        </div>
        <button onClick={cargar} style={btnSecundario}>Actualizar</button>
      </header>

      <main style={{ padding: '20px 24px', maxWidth: '860px', margin: '0 auto' }}>
        {error && <div style={errorStyle}>{error}</div>}

        {/* Resumen */}
        {!loading && turnos.length > 0 && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <Chip label="Pendientes" value={pendientes} color="#b45309" bg="#fef3c7" />
            <Chip label="Llegaron" value={llegaron} color="#1d4ed8" bg="#dbeafe" />
            <Chip label="Cobrados" value={cobrados} color="#166534" bg="#dcfce7" />
          </div>
        )}

        {/* Grilla */}
        <div style={{
          background: '#fff', borderRadius: '14px',
          border: '1px solid #e5e7eb', overflow: 'hidden',
        }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Cargando...</div>
          ) : (
            SLOTS.map((slot, i) => {
              const turno = turnoParaSlot(turnos, slot)
              const esMediaHora = slot.endsWith(':30')
              const esCada2h = i % 4 === 0

              return (
                <div
                  key={slot}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '64px 1fr',
                    borderBottom: i < SLOTS.length - 1 ? '1px solid #f1f5f9' : 'none',
                    minHeight: '44px',
                    background: turno ? '#fff' : (esMediaHora ? '#fafafa' : '#fff'),
                  }}
                >
                  {/* Hora */}
                  <div style={{
                    padding: '10px 12px',
                    fontSize: esMediaHora ? '11px' : '13px',
                    fontWeight: esMediaHora ? 400 : 700,
                    color: esMediaHora ? '#cbd5e1' : '#64748b',
                    borderRight: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    userSelect: 'none',
                  }}>
                    {!esMediaHora || esCada2h ? slot : '·'}
                  </div>

                  {/* Contenido */}
                  <div style={{ display: 'flex', alignItems: 'center', padding: '6px 14px', gap: '10px' }}>
                    {turno ? (
                      <>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '14px', color: '#1f2937' }}>
                            {turno.cliente || 'Sin nombre'}
                          </div>
                          {(turno.servicio || turno.profesional) && (
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '1px' }}>
                              {[turno.servicio, turno.profesional].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>

                        <EstadoBadge estado={turno.estado} />

                        {turno.estado !== 'Cobrado' && turno.estado !== 'Cancelado' && (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            {turno.estado !== 'Llegó' && (
                              <button
                                onClick={() => handleLlego(turno)}
                                disabled={accionando === turno.idTurno}
                                style={{ ...btnSlot, background: '#eff6ff', color: '#2563eb' }}
                              >
                                {accionando === turno.idTurno ? '...' : 'Llegó'}
                              </button>
                            )}
                            <button
                              onClick={() => { setModalTurno(turno); setMonto(''); setMetodoPago('efectivo') }}
                              disabled={accionando === turno.idTurno}
                              style={{ ...btnSlot, background: '#f0fdf4', color: '#16a34a' }}
                            >
                              Cobrar
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ height: '28px' }} />
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {!loading && turnos.length === 0 && !error && (
          <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px', marginTop: '16px' }}>
            Sin turnos registrados hoy. Enviá una foto de la agenda al bot para cargarlos.
          </p>
        )}
      </main>

      {/* Modal cobro */}
      {modalTurno && (
        <div style={overlayStyle} onClick={() => setModalTurno(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700 }}>Registrar cobro</h3>
            <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: '13px' }}>
              <strong>{modalTurno.cliente}</strong>
              {modalTurno.hora ? ` · ${modalTurno.hora}hs` : ''}
              {modalTurno.servicio ? ` · ${modalTurno.servicio}` : ''}
            </p>

            <label style={labelStyle}>Monto ($)</label>
            <input
              type="number"
              placeholder="15000"
              value={monto}
              onChange={e => setMonto(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmarCobro()}
              style={inputStyle}
              autoFocus
            />

            <label style={labelStyle}>Método de pago</label>
            <select value={metodoPago} onChange={e => setMetodoPago(e.target.value)} style={inputStyle}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
            </select>

            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button onClick={() => setModalTurno(null)} style={{ ...btnSecundario, flex: 1 }}>Cancelar</button>
              <button
                onClick={confirmarCobro}
                disabled={guardando}
                style={{ ...btnPrimario, flex: 1, opacity: guardando ? 0.6 : 1 }}
              >
                {guardando ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EstadoBadge({ estado }) {
  const e = ESTADOS[estado] || ESTADOS.Pendiente
  return (
    <span style={{
      padding: '2px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: 700,
      background: e.bg, color: e.color, whiteSpace: 'nowrap',
    }}>
      {e.label}
    </span>
  )
}

function Chip({ label, value, color, bg }) {
  return (
    <div style={{
      background: bg, color, borderRadius: '8px',
      padding: '6px 14px', fontSize: '13px', fontWeight: 600,
    }}>
      {value} {label}
    </div>
  )
}

const btnPrimario = {
  background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', color: '#fff',
  border: 'none', borderRadius: '8px', padding: '10px 16px',
  fontWeight: 600, fontSize: '14px', cursor: 'pointer',
}
const btnSecundario = {
  background: '#fff', color: '#374151', border: '1px solid #e5e7eb',
  borderRadius: '8px', padding: '8px 16px', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
}
const btnSlot = {
  border: 'none', borderRadius: '6px', padding: '5px 10px',
  fontWeight: 600, fontSize: '12px', cursor: 'pointer',
}
const errorStyle = {
  background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626',
  padding: '12px', borderRadius: '10px', marginBottom: '16px', fontSize: '14px',
}
const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
}
const modalStyle = {
  background: '#fff', borderRadius: '16px', padding: '24px',
  width: '100%', maxWidth: '380px', margin: '16px',
}
const labelStyle = { display: 'block', fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }
const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e5e7eb',
  fontSize: '14px', outline: 'none', boxSizing: 'border-box', marginBottom: '14px',
}
