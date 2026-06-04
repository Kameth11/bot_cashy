import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'

const ESTADOS = {
  Pendiente: { label: 'Pendiente', bg: '#fef3c7', color: '#b45309' },
  'Llegó':   { label: 'Llegó',    bg: '#dbeafe', color: '#1d4ed8' },
  Cobrado:   { label: 'Cobrado',  bg: '#dcfce7', color: '#166534' },
  Cancelado: { label: 'Cancelado',bg: '#fee2e2', color: '#b91c1c' },
}

export default function AgendaPage() {
  const [turnos, setTurnos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cobrandoId, setCobrandoId] = useState(null)
  const [modalTurno, setModalTurno] = useState(null)
  const [monto, setMonto] = useState('')
  const [metodoPago, setMetodoPago] = useState('efectivo')
  const [accionando, setAccionando] = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/api/agenda')
      setTurnos(data.turnos || [])
    } catch {
      setError('No se pudo cargar la agenda')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function handleLlego(turno) {
    setAccionando(turno.idTurno)
    try {
      await api.post(`/api/agenda/${turno.idTurno}/llego`)
      setTurnos(prev => prev.map(t => t.idTurno === turno.idTurno ? { ...t, estado: 'Llegó' } : t))
    } catch {
      alert('Error al registrar llegada')
    } finally {
      setAccionando(null)
    }
  }

  function abrirModalCobrar(turno) {
    setModalTurno(turno)
    setMonto('')
    setMetodoPago('efectivo')
    setCobrandoId(null)
  }

  async function confirmarCobro() {
    if (!monto || isNaN(Number(monto)) || Number(monto) <= 0) {
      alert('Ingresá un monto válido')
      return
    }
    setCobrandoId(modalTurno.idTurno)
    try {
      await api.patch(`/api/agenda/${modalTurno.idTurno}/cobrado`, {
        monto: Number(monto),
        metodoPago,
        moneda: 'Pesos',
      })
      setTurnos(prev => prev.map(t => t.idTurno === modalTurno.idTurno ? { ...t, estado: 'Cobrado' } : t))
      setModalTurno(null)
    } catch {
      alert('Error al registrar cobro')
    } finally {
      setCobrandoId(null)
    }
  }

  const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6' }}>
      <header style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1f2937' }}>Agenda</h1>
          <p style={{ color: '#64748b', fontSize: '13px', textTransform: 'capitalize' }}>{hoy}</p>
        </div>
        <button onClick={cargar} style={btnSecundario}>Actualizar</button>
      </header>

      <main style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
        {error && <div style={errorStyle}>{error}</div>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Cargando turnos...</div>
        ) : turnos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8', fontSize: '14px' }}>
            No hay turnos registrados para hoy.<br />
            <span style={{ fontSize: '12px' }}>Enviá una foto de la agenda al bot para cargarlos.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {turnos
              .slice()
              .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''))
              .map(turno => (
                <TurnoCard
                  key={turno.idTurno}
                  turno={turno}
                  accionando={accionando === turno.idTurno}
                  onLlego={() => handleLlego(turno)}
                  onCobrar={() => abrirModalCobrar(turno)}
                />
              ))}
          </div>
        )}
      </main>

      {modalTurno && (
        <div style={overlayStyle} onClick={() => setModalTurno(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700 }}>Registrar cobro</h3>
            <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: '13px' }}>
              {modalTurno.cliente}{modalTurno.servicio ? ` · ${modalTurno.servicio}` : ''}
            </p>

            <label style={labelStyle}>Monto ($)</label>
            <input
              type="number"
              placeholder="15000"
              value={monto}
              onChange={e => setMonto(e.target.value)}
              style={inputStyle}
              autoFocus
            />

            <label style={labelStyle}>Método de pago</label>
            <select value={metodoPago} onChange={e => setMetodoPago(e.target.value)} style={inputStyle}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
            </select>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={() => setModalTurno(null)} style={{ ...btnSecundario, flex: 1 }}>Cancelar</button>
              <button
                onClick={confirmarCobro}
                disabled={!!cobrandoId}
                style={{ ...btnPrimario, flex: 1, opacity: cobrandoId ? 0.6 : 1 }}
              >
                {cobrandoId ? 'Guardando...' : 'Confirmar cobro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TurnoCard({ turno, accionando, onLlego, onCobrar }) {
  const estado = ESTADOS[turno.estado] || ESTADOS.Pendiente
  const cobrado = turno.estado === 'Cobrado'
  const llego = turno.estado === 'Llegó'

  return (
    <div style={{
      background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb',
      padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '16px',
    }}>
      <div style={{ fontSize: '20px', fontWeight: 800, color: '#0ea5e9', minWidth: '52px' }}>
        {turno.hora || '--:--'}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '15px', color: '#1f2937', marginBottom: '2px' }}>
          {turno.cliente || 'Sin nombre'}
        </div>
        <div style={{ fontSize: '12px', color: '#64748b' }}>
          {[turno.servicio, turno.profesional].filter(Boolean).join(' · ')}
        </div>
      </div>

      <span style={{
        padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700,
        background: estado.bg, color: estado.color, whiteSpace: 'nowrap',
      }}>
        {estado.label}
      </span>

      {!cobrado && (
        <div style={{ display: 'flex', gap: '8px' }}>
          {!llego && (
            <button
              onClick={onLlego}
              disabled={accionando}
              style={{ ...btnSecundario, fontSize: '12px', padding: '6px 12px' }}
            >
              {accionando ? '...' : 'Llegó'}
            </button>
          )}
          <button
            onClick={onCobrar}
            disabled={accionando}
            style={{ ...btnPrimario, fontSize: '12px', padding: '6px 12px' }}
          >
            Cobrar
          </button>
        </div>
      )}
    </div>
  )
}

const btnPrimario = {
  background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', color: '#fff',
  border: 'none', borderRadius: '8px', padding: '8px 16px',
  fontWeight: 600, fontSize: '13px', cursor: 'pointer',
}
const btnSecundario = {
  background: '#fff', color: '#374151', border: '1px solid #e5e7eb',
  borderRadius: '8px', padding: '8px 16px', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
}
const errorStyle = {
  background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626',
  padding: '12px', borderRadius: '10px', marginBottom: '20px', fontSize: '14px',
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
  fontSize: '14px', outline: 'none', boxSizing: 'border-box', marginBottom: '12px',
}
