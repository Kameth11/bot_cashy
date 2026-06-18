import { useState, useEffect, useCallback } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { api } from '../services/api'

const CONSULTORIO_MAP = {
  'consultorio 1': 'Laura',
  'consultorio 2': 'Diego',
  'consultorio 3': '',
}

// Opciones fijas de filtro: solo los consultorios con nombre asignado
const FILTROS_CONSULTORIO = Object.entries(CONSULTORIO_MAP)
  .filter(([, nombre]) => nombre !== '')
  .map(([, nombre]) => nombre)

// Normaliza variantes como "Consultorio N° 1", "Consultorio Nro. 1",
// "CONSULTORIO #1" a la forma "consultorio 1" que usa CONSULTORIO_MAP.
function normalizarConsultorioKey(value) {
  if (!value) return ''
  const key = String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const match = key.match(/consultorio[^0-9]*([0-9]+)/)
  if (match) return `consultorio ${match[1]}`
  return key
}

function resolverProfesional(profesional, consultorio) {
  if (consultorio) {
    const key = normalizarConsultorioKey(consultorio)
    if (Object.prototype.hasOwnProperty.call(CONSULTORIO_MAP, key)) return CONSULTORIO_MAP[key]
  }
  if (profesional) {
    const key = normalizarConsultorioKey(profesional)
    if (Object.prototype.hasOwnProperty.call(CONSULTORIO_MAP, key)) return CONSULTORIO_MAP[key]
  }
  return ''
}

const ESTADOS = {
  Pendiente: { label: 'Pendiente', bg: '#FFF4CE', color: '#FF8B00',  bar: '#FF8B00'  },
  'Llegó':   { label: 'Llegó',    bg: '#DEEBFF', color: '#0747A6',  bar: '#0747A6'  },
  Cobrado:   { label: 'Cobrado',  bg: '#E3FCEF', color: '#006644',  bar: '#006644'  },
  Cancelado: { label: 'Cancelado',bg: '#FFEBE6', color: '#BF2600',  bar: '#BF2600'  },
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
  const [modalEditar, setModalEditar] = useState(null)
  const [editForm, setEditForm] = useState({ cliente: '', servicio: '', profesional: '', hora: '' })
  const [editando, setEditando] = useState(false)
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [filtroProfesional, setFiltroProfesional] = useState(null)
  const [fechaOffset, setFechaOffset] = useState(0)

  function getFechaStr(offset) {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`
  }

  function getFechaLabel(offset) {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  }

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get(`/api/agenda?fecha=${getFechaStr(fechaOffset)}`)
      setTurnos(data.turnos || [])
    } catch {
      setError('No se pudo cargar la agenda. ¿Está corriendo el servidor?')
    } finally {
      setLoading(false)
    }
  }, [fechaOffset])

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

  async function confirmarEliminar() {
    setEliminando(true)
    try {
      await api.delete(`/api/agenda/${confirmandoEliminar.idTurno}`)
      setTurnos(prev => prev.filter(t => t.idTurno !== confirmandoEliminar.idTurno))
      setConfirmandoEliminar(null)
    } catch {
      alert('Error al eliminar el turno')
    } finally {
      setEliminando(false)
    }
  }

  function abrirEditar(turno) {
    setEditForm({ cliente: turno.cliente || '', servicio: turno.servicio || '', profesional: turno.profesional || '', hora: turno.hora || '' })
    setModalEditar(turno)
  }

  async function confirmarEdicion() {
    setEditando(true)
    try {
      await api.patch(`/api/agenda/${modalEditar.idTurno}`, editForm)
      setTurnos(prev => prev.map(t =>
        t.idTurno === modalEditar.idTurno ? { ...t, ...editForm } : t
      ))
      setModalEditar(null)
    } catch {
      alert('Error al guardar los cambios')
    } finally {
      setEditando(false)
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

  const esHoy = fechaOffset === 0

  // Profesionales ocasionales del día (no están en los chips fijos)
  const profesionalesExtra = [...new Set(
    turnos
      .map(t => resolverProfesional(t.profesional, t.consultorio))
      .filter(p => p && !FILTROS_CONSULTORIO.includes(p))
  )]

  const turnosFiltrados = filtroProfesional !== null
    ? turnos.filter(t => resolverProfesional(t.profesional, t.consultorio) === filtroProfesional)
    : turnos

  const turnosConTurno = turnosFiltrados.filter(t => t.estado !== 'Cancelado')
  const cobrados   = turnosConTurno.filter(t => t.estado === 'Cobrado').length
  const llegaron   = turnosConTurno.filter(t => t.estado === 'Llegó').length
  const pendientes = turnosConTurno.filter(t => t.estado === 'Pendiente').length

  const turnosList = [...turnosFiltrados].sort((a, b) =>
    (a.hora || '').localeCompare(b.hora || '')
  )

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Agenda</h1>
          <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>{getFechaLabel(fechaOffset)}</p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn-agenda" onClick={() => { setFechaOffset(o => o - 1); setFiltroProfesional(null) }} title="Día anterior">←</button>
          {!esHoy && (
            <button className="btn-agenda" onClick={() => { setFechaOffset(0); setFiltroProfesional(null) }}>Hoy</button>
          )}
          <button className="btn-agenda" onClick={() => { setFechaOffset(o => o + 1); setFiltroProfesional(null) }} disabled={esHoy} title="Día siguiente">→</button>
          <button className="btn-agenda" onClick={cargar}>↻</button>
        </div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Filtros por consultorio */}
      {!loading && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          <button
            className={`chip${filtroProfesional === null ? ' active' : ''}`}
            onClick={() => setFiltroProfesional(null)}
          >
            Todos
          </button>
          {FILTROS_CONSULTORIO.map(nombre => (
            <button
              key={nombre}
              className={`chip${filtroProfesional === nombre ? ' active' : ''}`}
              onClick={() => setFiltroProfesional(nombre)}
            >
              {nombre}
            </button>
          ))}
          {profesionalesExtra.map(nombre => (
            <button
              key={nombre}
              className={`chip${filtroProfesional === nombre ? ' active' : ''}`}
              onClick={() => setFiltroProfesional(nombre)}
            >
              {nombre}
            </button>
          ))}
        </div>
      )}

      {/* Summary chips */}
      {!loading && turnosFiltrados.length > 0 && (
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
            {esHoy
              ? 'Sin turnos hoy. Enviá una foto de la agenda al bot para cargarlos.'
              : 'Sin turnos para este día.'}
          </div>
        )}

        {!loading && turnosList.map((turno, i) => {
          const e = ESTADOS[turno.estado] || ESTADOS.Pendiente
          const puedeAccion = turno.estado !== 'Cobrado' && turno.estado !== 'Cancelado'
          return (
            <div key={turno.idTurno || i} className="agenda-appt">
              <span className="agenda-time">{turno.hora || '–'}</span>
              <div className="agenda-bar" style={{ background: e.bar }} />
              <div className="agenda-info">
                <div className="agenda-patient">{turno.cliente || 'Sin nombre'}</div>
                {(turno.servicio || resolverProfesional(turno.profesional, turno.consultorio)) && (
                  <div className="agenda-treat">
                    {[turno.servicio, resolverProfesional(turno.profesional, turno.consultorio)].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <span className="agenda-badge" style={{ background: e.bg, color: e.color, marginRight: 8 }}>
                {e.label}
              </span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button className="action-btn" title="Editar" onClick={() => abrirEditar(turno)}>
                  <Pencil size={14} />
                </button>
                <button className="action-btn" title="Eliminar" style={{ color: 'var(--red)' }} onClick={() => setConfirmandoEliminar(turno)}>
                  <Trash2 size={14} />
                </button>
                {puedeAccion && (
                  <>
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
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Eliminar modal */}
      {confirmandoEliminar && (
        <div className="overlay" onClick={() => setConfirmandoEliminar(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title" style={{ fontSize: 16 }}>¿Eliminar turno?</h2>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>
              <strong>{confirmandoEliminar.hora ? `${confirmandoEliminar.hora} · ` : ''}{confirmandoEliminar.cliente || 'Sin nombre'}</strong>
              <br />Esta acción borra la fila del Sheet y no se puede deshacer.
            </p>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setConfirmandoEliminar(null)}>Cancelar</button>
              <button className="btn-danger" onClick={confirmarEliminar} disabled={eliminando}>
                {eliminando ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edición modal */}
      {modalEditar && (
        <div className="overlay" onClick={() => setModalEditar(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title" style={{ fontSize: 16 }}>Editar turno</h2>
            <div className="modal-form">
              {[
                { label: 'Paciente', key: 'cliente' },
                { label: 'Servicio', key: 'servicio' },
                { label: 'Profesional', key: 'profesional' },
                { label: 'Hora', key: 'hora', placeholder: '09:00' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="form-label">{label}</label>
                  <input
                    className="form-input"
                    value={editForm[key]}
                    placeholder={placeholder || ''}
                    onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setModalEditar(null)}>Cancelar</button>
              <button className="btn-primary" onClick={confirmarEdicion} disabled={editando}>
                {editando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

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
