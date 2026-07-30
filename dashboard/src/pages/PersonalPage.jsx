import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '../services/api'
import MetricCard from '../components/MetricCard'
import { MontoCell } from '../components/Money'
import PresupuestosModal from '../components/PresupuestosModal'
import DatePickerButton from '../components/DatePickerButton'
import { useMovimientosEvents } from '../hooks/useMovimientosEvents'
import { useApp } from '../contexts/AppContext'
import { formatFecha, formatPesos, etiquetaCategoria } from '../utils/format'

// Paleta de la barra según cuánto se consumió del presupuesto.
function colorPresupuesto(porcentaje) {
  if (porcentaje > 100) return 'var(--red)'
  if (porcentaje >= 80) return 'var(--amber)'
  return 'var(--green)'
}

function claveMes(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`
}

function etiquetaMes(clave) {
  const [a, m] = clave.split('-').map(Number)
  // Se arma a mano en vez de con toLocaleDateString({month:'long',year:'2-digit'}),
  // que en es-AR devuelve "julio de 26".
  const nombre = new Date(a, m - 1, 1).toLocaleDateString('es-AR', { month: 'long' })
  const esteAnio = new Date().getFullYear()
  const capitalizado = nombre.charAt(0).toUpperCase() + nombre.slice(1)
  return a === esteAnio ? capitalizado : `${capitalizado} ${String(a).slice(-2)}`
}

// Tres meses desde el actual hacia atrás. Con pocos botones se reparten parejo
// el ancho y se leen bien en el celular; con seis quedaban apretados e
// ilegibles. Para cualquier mes más viejo está el calendario.
function mesesRecientes(cantidad = 3) {
  const hoy = new Date()
  return Array.from({ length: cantidad }, (_, i) =>
    claveMes(new Date(hoy.getFullYear(), hoy.getMonth() - i, 1))
  )
}

// Barra horizontal en CSS: el proyecto no tiene librería de charts y para esto
// no hace falta sumar una dependencia.
function BarraCategoria({ label, monto, porcentaje, color = 'var(--primary)' }) {
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

export default function PersonalPage() {
  const { reloadSignal } = useApp()

  const [mes,     setMes]     = useState(mesesRecientes(1)[0])
  const [fechaCal, setFechaCal] = useState('')
  const [resumen, setResumen] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [reload,  setReload]  = useState(0)

  const [categorias,     setCategorias]     = useState(null)
  const [showPresu,      setShowPresu]      = useState(false)
  const [guardandoPresu, setGuardandoPresu] = useState(false)
  const [presuError,     setPresuError]     = useState(null)

  // Si el mes elegido por calendario no está entre los tres recientes, se suma
  // como cuarto botón para que se vea cuál está activo.
  const meses = useMemo(() => {
    const recientes = mesesRecientes(3)
    return recientes.includes(mes) ? recientes : [...recientes, mes]
  }, [mes])

  const irAFecha = useCallback((iso) => {
    if (!iso) return
    setFechaCal(iso)
    setMes(iso.slice(0, 7)) // YYYY-MM-DD -> YYYY-MM
  }, [])

  // Las categorías las define el backend; se piden una sola vez.
  useEffect(() => {
    let active = true
    api.get('/api/personal/categorias')
      .then(res => { if (active) setCategorias(res.data) })
      .catch(() => { /* la vista funciona igual sin el editor de presupuestos */ })
    return () => { active = false }
  }, [])

  const handleGuardarPresupuesto = useCallback(async (payload) => {
    setPresuError(null)
    setGuardandoPresu(true)
    try {
      await api.put('/api/personal/presupuestos', payload)
      setReload(r => r + 1)
    } catch (err) {
      setPresuError(err?.response?.data?.error || 'No se pudo guardar el presupuesto')
    } finally {
      setGuardandoPresu(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    api.get('/api/personal/resumen', { params: { mes } })
      .then(res => { if (active) setResumen(res.data) })
      .catch(err => {
        if (!active) return
        setError(err?.response?.data?.error || 'No se pudo cargar el resumen personal')
      })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [mes, reload, reloadSignal])

  // Un gasto cargado por Telegram refresca esta vista al instante.
  useMovimientosEvents(useCallback(() => setReload(r => r + 1), []))

  const maxCategoria = resumen?.porCategoria?.[0]?.total || 0
  const excedidos = (resumen?.presupuestos || []).filter(p => p.excedido)

  return (
    <div className="page">
      {showPresu && (
        <PresupuestosModal
          categorias={categorias}
          presupuestos={resumen?.presupuestos || []}
          guardando={guardandoPresu}
          error={presuError}
          onGuardar={handleGuardarPresupuesto}
          onCerrar={() => { setShowPresu(false); setPresuError(null) }}
        />
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Personal</h1>
          <p className="page-subtitle">Gastos e ingresos de tu vida, separados del consultorio</p>
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
          <DatePickerButton
            value={fechaCal}
            onChange={irAFecha}
            title="Ir a otra fecha"
            className="period-cal-btn"
          />
        </div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 20 }}>{error}</div>}

      {excedidos.length > 0 && (
        <div className="presu-alerta">
          <strong>Te pasaste del presupuesto en {excedidos.length === 1 ? '1 categoría' : `${excedidos.length} categorías`}:</strong>
          {' '}
          {excedidos.map(p => `${etiquetaCategoria(p.categoria)} (${p.porcentaje}%)`).join(' · ')}
        </div>
      )}

      {loading && !resumen && <div className="empty-state">Cargando...</div>}

      {resumen && (
        <>
          <div className="metric-grid pers-metric-grid">
            <MetricCard
              label="Ingresos"
              value={formatPesos(resumen.ingresos)}
              variant="ingresos"
            />
            <MetricCard
              label="Gastos"
              value={formatPesos(resumen.egresos)}
              variant="egresos"
            />
            <MetricCard
              label="Balance"
              value={formatPesos(resumen.balance)}
              subtitle={resumen.balance >= 0 ? 'Te quedó a favor' : 'Gastaste más de lo que entró'}
              variant={resumen.balance >= 0 ? 'ingresos' : 'egresos'}
            />
          </div>

          {resumen.viaje && (
            <div className="card-surface pers-viaje">
              <div className="card-header">
                <span>✈️ Viaje activo · {resumen.viaje.nombre}</span>
              </div>
              <div className="pers-viaje-body">
                <div>
                  <div className="pers-viaje-total">{formatPesos(resumen.viaje.total)}</div>
                  <div className="pers-viaje-sub">
                    {resumen.viaje.cantidad} movimiento{resumen.viaje.cantidad === 1 ? '' : 's'}
                    {resumen.viaje.fechaInicio && ` · desde ${resumen.viaje.fechaInicio}`}
                    {resumen.viaje.fechaFin && ` hasta ${resumen.viaje.fechaFin}`}
                  </div>
                </div>
                {resumen.viaje.presupuesto > 0 && (
                  <div className="pers-viaje-presu">
                    <BarraCategoria
                      label="Presupuesto del viaje"
                      monto={resumen.viaje.presupuesto}
                      porcentaje={Math.round((resumen.viaje.total / resumen.viaje.presupuesto) * 100)}
                      color={colorPresupuesto(Math.round((resumen.viaje.total / resumen.viaje.presupuesto) * 100))}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="pers-cols">
            <div className="card-surface">
              <div className="card-header"><span>Gastos por categoría</span></div>
              <div className="pers-card-body">
                {resumen.porCategoria.length === 0 ? (
                  <div className="empty-state">Sin gastos este mes.</div>
                ) : (
                  resumen.porCategoria.map(c => (
                    <BarraCategoria
                      key={c.categoria}
                      label={etiquetaCategoria(c.categoria)}
                      monto={c.total}
                      // Relativo al rubro más alto: hace comparables las barras.
                      porcentaje={maxCategoria > 0 ? Math.round((c.total / maxCategoria) * 100) : 0}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="card-surface">
              <div className="card-header">
                <span>Presupuestos</span>
                <button className="card-header-link" onClick={() => setShowPresu(true)}>
                  {resumen.presupuestos.length === 0 ? 'Definir →' : 'Editar →'}
                </button>
              </div>
              <div className="pers-card-body">
                {resumen.presupuestos.length === 0 ? (
                  <div className="empty-state">
                    Todavía no definiste presupuestos.<br />
                    <button className="btn-link-inline" onClick={() => setShowPresu(true)}>
                      Definí uno
                    </button>{' '}y te aviso cuando te estés pasando.
                  </div>
                ) : (
                  resumen.presupuestos.map(p => (
                    <BarraCategoria
                      key={p.categoria}
                      label={`${etiquetaCategoria(p.categoria)} · ${formatPesos(p.gastado)} de ${formatPesos(p.limite)}`}
                      monto={p.restante}
                      porcentaje={p.porcentaje}
                      color={colorPresupuesto(p.porcentaje)}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="card-surface" style={{ marginTop: 18 }}>
            <div className="card-header">
              <span>Movimientos del mes ({resumen.cantidad})</span>
            </div>
            {resumen.movimientos.length === 0 ? (
              <div className="empty-state">
                Sin movimientos personales este mes.<br />
                Cargalos por Telegram: <code>nafta 20000</code>, <code>super 45000</code>.
              </div>
            ) : (
              <div className="pers-lista">
                {resumen.movimientos.map(m => (
                  <div key={m.idMov} className="pers-item">
                    <div className="pers-item-main">
                      <span className="pers-item-desc">{m.descripcion}</span>
                      <span className="pers-item-meta">
                        {formatFecha(m.fecha)}
                        {m.categoria && ` · ${etiquetaCategoria(m.categoria)}`}
                        {m.metodoPago && ` · ${m.metodoPago}`}
                        {m.viajeId && ' · ✈️'}
                      </span>
                    </div>
                    <MontoCell mov={m} />
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
