import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import MetricCard from '../components/MetricCard'
import BarraCategoria from '../components/BarraCategoria'
import NuevoCasaModal from '../components/NuevoCasaModal'
import DatePickerButton from '../components/DatePickerButton'
import { useMovimientosEvents } from '../hooks/useMovimientosEvents'
import { useApp } from '../contexts/AppContext'
import { formatFecha, formatMontoConMoneda, etiquetaCategoria } from '../utils/format'
import { etiquetaMes, mesesRecientes } from '../utils/meses'

const mensajeDe = (err, porDefecto) => err?.response?.data?.error || porDefecto

// Crear una casa nueva o unirse a una con un código de invitación.
function CasaVacia({ onListo, compacto = false }) {
  const [nombre, setNombre] = useState('')
  const [alias, setAlias] = useState('')
  const [codigo, setCodigo] = useState('')
  const [aliasUnir, setAliasUnir] = useState('')
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  async function enviar(e, ruta, payload) {
    e.preventDefault()
    setError(null)
    setOcupado(true)
    try {
      const { data } = await api.post(ruta, payload)
      onListo(data.casa.casaId)
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo completar la acción'))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className={compacto ? '' : 'page'}>
      {!compacto && (
        <div className="page-header">
          <div>
            <h1 className="page-title">Casa</h1>
            <p className="page-subtitle">Gastos compartidos con quienes viven con vos: quién pagó, cuánto y quién debe qué</p>
          </div>
        </div>
      )}
      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}
      <div className="pers-cols">
        <form className="card-surface" onSubmit={e => enviar(e, '/api/casa', { nombre, alias })}>
          <div className="card-header"><span>Crear una casa</span></div>
          <div className="pers-card-body modal-form">
            <div>
              <label className="form-label">Nombre *</label>
              <input className="form-input" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Casa, Casa Dinamarca" maxLength={40} required />
            </div>
            <div>
              <label className="form-label">Cómo te van a ver</label>
              <input className="form-input" value={alias} onChange={e => setAlias(e.target.value)} placeholder="Tu nombre o apodo" maxLength={40} />
            </div>
            <button type="submit" className="btn-primary" disabled={ocupado}>Crear casa</button>
          </div>
        </form>
        <form className="card-surface" onSubmit={e => enviar(e, '/api/casa/unir', { codigo, alias: aliasUnir })}>
          <div className="card-header"><span>Unirme con un código</span></div>
          <div className="pers-card-body modal-form">
            <div>
              <label className="form-label">Código de invitación *</label>
              <input className="form-input casa-codigo-input" value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())} placeholder="ABC234" maxLength={6} required />
            </div>
            <div>
              <label className="form-label">Cómo te van a ver</label>
              <input className="form-input" value={aliasUnir} onChange={e => setAliasUnir(e.target.value)} placeholder="Tu nombre o apodo" maxLength={40} />
            </div>
            <button type="submit" className="btn-primary" disabled={ocupado}>Unirme</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Saldos({ saldos, yo, onPagar }) {
  const monedas = Object.keys(saldos || {})
  if (monedas.length === 0) return <div className="empty-state">Todavía no hay gastos cargados.</div>

  return monedas.map(moneda => {
    const { transferencias, saldos: porPersona } = saldos[moneda]
    return (
      <div key={moneda} className="casa-saldo-bloque">
        <div className="casa-saldo-moneda">{moneda}</div>
        {transferencias.length === 0 ? (
          <div className="casa-saldo-ok">✅ Todo saldado</div>
        ) : transferencias.map(t => (
          <div key={`${t.de}-${t.para}`} className="casa-saldo-row">
            <span><strong>{t.deNombre}</strong> le debe a <strong>{t.paraNombre}</strong></span>
            <span className="casa-saldo-monto">{formatMontoConMoneda(t.monto, moneda)}</span>
            {(t.de === yo.id || t.para === yo.id) && (
              <button className="btn-secondary casa-btn-chico" onClick={() => onPagar(t, moneda)}>Registrar pago</button>
            )}
          </div>
        ))}
        <div className="casa-saldo-personas">
          {porPersona.filter(p => p.saldo !== 0).map(p => (
            <span key={p.id} className={`casa-chip ${p.saldo > 0 ? 'a-favor' : 'en-contra'}`}>
              {p.nombre}: {p.saldo > 0 ? '+' : '−'}{formatMontoConMoneda(Math.abs(p.saldo), moneda)}
            </span>
          ))}
        </div>
      </div>
    )
  })
}

export default function CasaPage() {
  const { casaId } = useParams()
  const navigate = useNavigate()
  const { reloadSignal } = useApp()

  const [casas, setCasas] = useState(null)
  const [mes, setMes] = useState(mesesRecientes(1)[0])
  const [fechaCal, setFechaCal] = useState('')
  // El resumen se guarda junto con la clave de lo que se pidió: "cargando" se
  // deriva de comparar claves, en vez de setearlo dentro del efecto.
  const [estado, setEstado] = useState({ clave: null, resumen: null, error: null })
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [editando, setEditando] = useState(null)   // gasto que se está corrigiendo
  const [guardandoEdicion, setGuardandoEdicion] = useState(false)
  const [edicionError, setEdicionError] = useState(null)
  const [mostrarOtra, setMostrarOtra] = useState(false)
  const [nuevoMiembro, setNuevoMiembro] = useState('')
  const [invitacion, setInvitacion] = useState(null)

  const meses = useMemo(() => {
    const recientes = mesesRecientes(3)
    return recientes.includes(mes) ? recientes : [...recientes, mes]
  }, [mes])

  const refrescar = useCallback(() => setReload(r => r + 1), [])

  // Mis casas.
  useEffect(() => {
    let active = true
    api.get('/api/casa')
      .then(res => { if (active) setCasas(res.data.casas) })
      .catch(err => { if (active) { setCasas([]); setError(mensajeDe(err, 'No se pudieron cargar tus casas')) } })
    return () => { active = false }
  }, [reload, reloadSignal])

  // /casa sin id: ir a la activa. Un id que ya no es mío: volver a /casa.
  useEffect(() => {
    if (!casas || casas.length === 0) return
    const existe = casas.some(c => c.casaId === casaId)
    if (!casaId || !existe) {
      const destino = casas.find(c => c.activa) || casas[0]
      navigate(`/casa/${destino.casaId}`, { replace: true })
    }
  }, [casas, casaId, navigate])

  const casaValida = Boolean(casaId && casas?.some(c => c.casaId === casaId))

  const clave = `${casaId}|${mes}|${reload}|${reloadSignal}`

  useEffect(() => {
    if (!casaValida) return undefined
    let active = true
    api.get(`/api/casa/${casaId}/resumen`, { params: { mes } })
      .then(res => { if (active) setEstado({ clave, resumen: res.data, error: null }) })
      .catch(err => {
        if (active) setEstado(prev => ({ clave, resumen: prev.resumen, error: mensajeDe(err, 'No se pudo cargar la casa') }))
      })
    return () => { active = false }
  }, [casaId, casaValida, mes, clave])

  // Mientras se cambia de casa no se muestra el resumen de la anterior.
  const resumen = estado.resumen && estado.resumen.casa.casaId === casaId ? estado.resumen : null
  const loading = estado.clave !== clave

  // Un gasto cargado por Telegram o por otro miembro refresca la vista.
  useMovimientosEvents(refrescar)

  const irAFecha = useCallback((iso) => {
    if (!iso) return
    setFechaCal(iso)
    setMes(iso.slice(0, 7))
  }, [])

  async function accion(fn, mensajeError) {
    setError(null)
    try {
      await fn()
      refrescar()
    } catch (err) {
      setError(mensajeDe(err, mensajeError))
    }
  }

  const cambiarCasa = (id) => {
    navigate(`/casa/${id}`)
    api.post(`/api/casa/${id}/activar`).catch(() => {})
  }

  const nombreDe = useMemo(() => {
    const mapa = new Map((resumen?.miembros || []).map(m => [m.id, m.nombre]))
    return (id) => mapa.get(id) || 'ex miembro'
  }, [resumen])

  const pagar = (t, moneda) => {
    if (!window.confirm(`¿Registrar que ${t.deNombre} le pagó ${formatMontoConMoneda(t.monto, moneda)} a ${t.paraNombre}?`)) return
    accion(() => api.post(`/api/casa/${casaId}/liquidaciones`, { de: t.de, para: t.para, monto: t.monto, moneda }), 'No se pudo registrar el pago')
  }

  const guardarEdicion = async (cambios) => {
    setEdicionError(null)
    setGuardandoEdicion(true)
    try {
      await api.put(`/api/casa/${casaId}/movimientos/${editando.idMov}`, cambios)
      setEditando(null)
      refrescar()
    } catch (err) {
      setEdicionError(mensajeDe(err, 'No se pudo guardar el cambio'))
    } finally {
      setGuardandoEdicion(false)
    }
  }

  const borrar = (m) => {
    if (!window.confirm(`¿Borrar "${m.descripcion}"? Los saldos se recalculan.`)) return
    accion(() => api.delete(`/api/casa/${casaId}/movimientos/${m.idMov}`), 'No se pudo borrar el movimiento')
  }

  const agregar = (e) => {
    e.preventDefault()
    const nombre = nuevoMiembro.trim()
    if (!nombre) return
    accion(async () => { await api.post(`/api/casa/${casaId}/miembros`, { nombre }); setNuevoMiembro('') }, 'No se pudo agregar a la persona')
  }

  const invitar = async (miembro) => {
    setError(null)
    try {
      const { data } = await api.post(`/api/casa/${casaId}/invitaciones`, miembro ? { miembroId: miembro.id } : {})
      setInvitacion({ codigo: data.codigo, para: miembro?.nombre || null })
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo generar la invitación'))
    }
  }

  const quitar = (miembro) => {
    const esYo = miembro.id === resumen.yo.id
    const pregunta = esYo ? `¿Salir de ${resumen.casa.nombre}?` : `¿Quitar a ${miembro.nombre} de la casa? Su historial queda registrado.`
    if (!window.confirm(pregunta)) return
    accion(async () => {
      await api.delete(`/api/casa/${casaId}/miembros/${miembro.id}`)
      if (esYo) navigate('/casa', { replace: true })
    }, 'No se pudo completar la acción')
  }

  if (casas === null) return <div className="page"><div className="empty-state">Cargando...</div></div>
  if (casas.length === 0) return <CasaVacia onListo={() => { refrescar(); navigate('/casa') }} />
  if (!casaValida) return <div className="page"><div className="empty-state">Cargando...</div></div>

  const monedasGasto = Object.keys(resumen?.gastosPorMoneda || {})
  const totalGastos = monedasGasto.length
    ? monedasGasto.map(m => formatMontoConMoneda(resumen.gastosPorMoneda[m], m)).join(' + ')
    : formatMontoConMoneda(0, 'Pesos')
  const maxCategoria = resumen?.porCategoria?.[0]?.total || 0

  return (
    <div className="page">
      {editando && (
        <NuevoCasaModal
          casaId={casaId}
          inicial={editando}
          guardando={guardandoEdicion}
          error={edicionError}
          onGuardar={guardarEdicion}
          onCerrar={() => { setEditando(null); setEdicionError(null) }}
        />
      )}
      <div className="page-header">
        <div>
          <h1 className="page-title">🏡 {resumen?.casa.nombre || casas.find(c => c.casaId === casaId)?.nombre}</h1>
          <p className="page-subtitle">Gastos compartidos: quién pagó, cuánto y quién debe qué</p>
        </div>
        <div className="pers-periodo">
          <div className="period-sel">
            {meses.map(valor => (
              <button
                key={valor}
                className={`period-btn${mes === valor ? ' active' : ''}`}
                onClick={() => { setMes(valor); setFechaCal('') }}
              >
                {etiquetaMes(valor)}
              </button>
            ))}
          </div>
          <DatePickerButton value={fechaCal} onChange={irAFecha} title="Ir a otra fecha" className="period-cal-btn" />
        </div>
      </div>

      {(casas.length > 1 || mostrarOtra) && (
        <div className="casa-selector">
          {casas.map(c => (
            <button key={c.casaId} className={`period-btn${c.casaId === casaId ? ' active' : ''}`} onClick={() => cambiarCasa(c.casaId)}>
              {c.nombre}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginBottom: 14 }}>
        <button className="btn-link-inline" onClick={() => setMostrarOtra(v => !v)}>
          {mostrarOtra ? 'Ocultar' : '＋ Crear otra casa o unirme con un código'}
        </button>
      </div>
      {mostrarOtra && (
        <div style={{ marginBottom: 20 }}>
          <CasaVacia compacto onListo={(id) => { setMostrarOtra(false); refrescar(); navigate(`/casa/${id}`) }} />
        </div>
      )}

      {(error || estado.error) && <div className="error-box" style={{ marginBottom: 20 }}>{error || estado.error}</div>}
      {loading && !resumen && <div className="empty-state">Cargando...</div>}

      {resumen && (
        <>
          <div className="metric-grid pers-metric-grid">
            <MetricCard label="Gastos del mes" value={totalGastos} variant="egresos" />
            <MetricCard label="Movimientos" value={String(resumen.cantidad)} subtitle="en el mes" variant="ingresos" />
            <MetricCard label="Personas" value={String(resumen.miembros.length)} subtitle={resumen.miembros.map(m => m.nombre).join(', ')} variant="ingresos" />
          </div>

          <div className="pers-cols">
            <div className="card-surface">
              <div className="card-header"><span>Saldos</span></div>
              <div className="pers-card-body">
                <Saldos saldos={resumen.saldos} yo={resumen.yo} onPagar={pagar} />
              </div>
            </div>

            <div className="card-surface">
              <div className="card-header"><span>Gastos por categoría</span></div>
              <div className="pers-card-body">
                {resumen.porCategoria.length === 0 ? (
                  <div className="empty-state">Sin gastos este mes.</div>
                ) : resumen.porCategoria.map(c => (
                  <BarraCategoria
                    key={c.categoria}
                    label={etiquetaCategoria(c.categoria)}
                    monto={c.total}
                    porcentaje={maxCategoria > 0 ? Math.round((c.total / maxCategoria) * 100) : 0}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="card-surface" style={{ marginTop: 18 }}>
            <div className="card-header">
              <span>Personas</span>
              <button className="card-header-link" onClick={() => invitar(null)}>Invitar con un código →</button>
            </div>
            <div className="pers-card-body">
              {invitacion && (
                <div className="casa-invitacion">
                  <div>
                    Código{invitacion.para ? ` para ${invitacion.para}` : ''} (vale 24 h, un solo uso):
                    <span className="casa-codigo">{invitacion.codigo}</span>
                  </div>
                  <div className="pers-item-meta">
                    La persona entra a Casa → “Unirme con un código”, o le escribe al bot <code>/unir {invitacion.codigo}</code>.
                    Tiene que tener su propia cuenta.
                  </div>
                </div>
              )}
              {resumen.miembros.map(m => (
                <div key={m.id} className="casa-miembro">
                  <span>
                    {m.nombre}
                    {m.id === resumen.yo.id && <span className="casa-chip"> vos</span>}
                    {m.rol === 'creador' && <span className="casa-chip"> 👑</span>}
                    {m.esVirtual && <span className="casa-chip"> sin Telegram</span>}
                  </span>
                  <span className="casa-miembro-acciones">
                    {m.esVirtual && <button className="action-btn" title="Generar código para que se una" onClick={() => invitar(m)}>🔑</button>}
                    {(m.id === resumen.yo.id ? m.rol !== 'creador' : resumen.esCreador) && m.rol !== 'creador' && (
                      <button className="action-btn" title={m.id === resumen.yo.id ? 'Salir de la casa' : 'Quitar'} onClick={() => quitar(m)}>✕</button>
                    )}
                  </span>
                </div>
              ))}
              <form className="casa-agregar" onSubmit={agregar}>
                <input className="form-input" value={nuevoMiembro} onChange={e => setNuevoMiembro(e.target.value)} placeholder="Sumar a alguien sin Telegram (ej: Tomás)" maxLength={40} />
                <button type="submit" className="btn-secondary" disabled={!nuevoMiembro.trim()}>Agregar</button>
              </form>
            </div>
          </div>

          <div className="card-surface" style={{ marginTop: 18 }}>
            <div className="card-header"><span>Movimientos del mes ({resumen.cantidad})</span></div>
            {resumen.movimientos.length === 0 ? (
              <div className="empty-state">
                Sin movimientos este mes.<br />
                Cargalos con el botón + Nuevo o por Telegram: <code>super 45000 casa</code>.
              </div>
            ) : (
              <div className="pers-lista">
                {resumen.movimientos.map(m => (
                  <div key={m.idMov} className="pers-item">
                    <div className="pers-item-main">
                      <span className="pers-item-desc">{m.tipo === 'liquidacion' ? '💸 ' : ''}{m.descripcion}</span>
                      <span className="pers-item-meta">
                        {formatFecha(m.fecha)}
                        {m.tipo === 'gasto' && m.categoria && ` · ${etiquetaCategoria(m.categoria)}`}
                        {m.tipo === 'gasto' && ` · pagó ${nombreDe(m.pagoPor)}`}
                        {m.tipo === 'gasto' && m.repartoEntre.length > 0 && ` · entre ${m.repartoEntre.length === resumen.miembros.length ? 'todos' : m.repartoEntre.map(nombreDe).join(', ')}`}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="casa-saldo-monto">{formatMontoConMoneda(m.monto, m.moneda)}</span>
                      {m.puedoBorrar && m.tipo === 'gasto' && <button className="action-btn" title="Editar" onClick={() => { setEdicionError(null); setEditando(m) }}>✏️</button>}
                      {m.puedoBorrar && <button className="action-btn" title="Borrar" onClick={() => borrar(m)}>🗑</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
