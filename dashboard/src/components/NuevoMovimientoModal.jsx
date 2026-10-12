import { useState, useMemo, useEffect } from 'react'
import { api } from '../services/api'
import { formatMontoConMoneda } from '../utils/format'
import { MAX_CUOTAS, esFechaIso, fechaCorta, planDeCuotas } from '../utils/cuotas'

// ── Shared helpers ─────────────────────────────────────────
function Seg({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className={`seg-btn${active ? ' active' : ''}`}>
      {children}
    </button>
  )
}

function Hint({ children }) {
  return <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 0', lineHeight: 1.4 }}>{children}</p>
}

export const CATEGORIAS_INGRESO = [
  { value: '', label: 'Sin categoría' },
  { value: 'consulta', label: 'Consulta' },
  { value: 'tratamiento', label: 'Tratamiento' },
  { value: 'anticipo', label: 'Anticipo' },
  { value: 'sena', label: 'Seña' },
  { value: 'cuota', label: 'Cuota' },
  { value: 'saldo_final', label: 'Saldo final' },
  { value: 'honorarios', label: 'Honorarios' },
  { value: 'otro_ingreso', label: 'Otro ingreso' },
]

export const CATEGORIAS_EGRESO = [
  { value: '', label: 'Sin categoría' },
  { value: 'sueldos', label: 'Sueldos' },
  { value: 'honorarios', label: 'Honorarios' },
  { value: 'insumos', label: 'Insumos' },
  { value: 'alquiler', label: 'Alquiler' },
  { value: 'expensas', label: 'Expensas' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'impuestos', label: 'Impuestos' },
  { value: 'mantenimiento', label: 'Mantenimiento' },
  { value: 'software', label: 'Software' },
  { value: 'otro_egreso', label: 'Otro egreso' },
]

const DESCRIPCIONES_INGRESO = [
  'Consulta general',
  'Tratamiento',
]

const DESCRIPCIONES_EGRESO = [
  'Compra de insumos',
  'Pago de servicios',
]

const OTRO_VALUE = '__otro__'

// Hoy como AAAA-MM-DD en la zona del navegador (lo que usa <input type="date">).
const hoyIso = () => new Date().toLocaleDateString('en-CA')

// DD/MM/AAAA (lo que entrega la API) o AAAA-MM-DD -> AAAA-MM-DD para <input type="date">.
function aInputFecha(valor) {
  const t = String(valor || '').trim()
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : ''
}

const initialState = {
  tipo: 'Ingreso',
  descripcionPreset: '',
  descripcionLibre: '',
  monto: '',
  moneda: 'Pesos',
  metodoPago: '',
  estado: 'Cobrado',
  categoria: '',
  contraparte: '',        // paciente (ingreso) o proveedor (egreso)
  profesional: '',
  tratamiento: '',
  fecha: '',
  fechaPrestacion: '',
  fechaVencimiento: '',
  cuotaCantidad: '1',
  cuotaPrimeraCobrada: true,
  cuotaPrimerVencimiento: '',
}

// Del movimiento que se edita al estado del formulario.
function formularioDesde(m) {
  const esEgreso = String(m.tipo).toLowerCase() === 'egreso'
  const lista = esEgreso ? DESCRIPCIONES_EGRESO : DESCRIPCIONES_INGRESO
  const descripcion = m.descripcion || ''
  const enLista = lista.includes(descripcion)
  const pendiente = String(m.estado).toLowerCase() === 'pendiente'
  return {
    ...initialState,
    tipo: esEgreso ? 'Egreso' : 'Ingreso',
    descripcionPreset: enLista ? descripcion : OTRO_VALUE,
    descripcionLibre: enLista ? '' : descripcion,
    monto: String(Math.abs(Number(m.monto || 0))),
    moneda: m.moneda || 'Pesos',
    metodoPago: m.metodoPago || '',
    estado: pendiente ? 'Pendiente' : (esEgreso ? 'Pagado' : 'Cobrado'),
    categoria: m.categoria || '',
    contraparte: (esEgreso ? m.proveedor : m.paciente) || '',
    profesional: m.profesional || '',
    tratamiento: m.tratamiento || '',
    fecha: aInputFecha(m.fecha),
    fechaPrestacion: aInputFecha(m.fechaPrestacion),
    fechaVencimiento: aInputFecha(m.fechaVencimiento),
  }
}

/**
 * Alta de un movimiento del consultorio o, si llega `inicial`, su edición COMPLETA (todos los campos).
 * En edición `onGuardar` recibe solo lo que cambió; al crear, el movimiento entero (y, si es una cuota con
 * más de una, el plan de cuotas: el monto es el total y se reparte, ver utils/cuotas.js).
 */
export default function NuevoMovimientoModal({ guardando, error, onGuardar, onCerrar, inicial = null }) {
  const editando = Boolean(inicial)
  const [form, setForm] = useState(() => (inicial ? formularioDesde(inicial) : { ...initialState, cuotaPrimerVencimiento: hoyIso() }))
  const [validationError, setValidationError] = useState(null)
  const [profesionales, setProfesionales] = useState(null) // null = no se pudo leer: se escribe a mano

  // Los profesionales ya registrados (y los que figuran en la agenda). Sin permiso de agenda, se escribe a mano.
  useEffect(() => {
    let activo = true
    api.get('/api/profesionales')
      .then(res => { if (activo) setProfesionales(Array.isArray(res.data?.profesionales) ? res.data.profesionales : null) })
      .catch(() => {})
    return () => { activo = false }
  }, [])

  const esIngreso = form.tipo === 'Ingreso'
  const esPendiente = form.estado === 'Pendiente'

  const categorias = useMemo(() => {
    const base = form.tipo === 'Egreso' ? CATEGORIAS_EGRESO : CATEGORIAS_INGRESO
    // Una categoría que no está en la lista (la puso el bot) se conserva en vez de perderse al editar.
    return form.categoria && !base.some(c => c.value === form.categoria)
      ? [...base, { value: form.categoria, label: form.categoria }]
      : base
  }, [form.tipo, form.categoria])

  const descripciones = useMemo(
    () => (form.tipo === 'Egreso' ? DESCRIPCIONES_EGRESO : DESCRIPCIONES_INGRESO),
    [form.tipo]
  )

  const opcionesProfesional = useMemo(() => {
    if (!profesionales) return null
    const lista = [...profesionales]
    if (form.profesional && !lista.includes(form.profesional)) lista.push(form.profesional)
    return lista
  }, [profesionales, form.profesional])

  const esOtraDescripcion = form.descripcionPreset === OTRO_VALUE

  const update = (field) => (e) => {
    const value = e.target.value
    setForm(f => ({ ...f, [field]: value }))
  }

  // Cambiar el tipo: la categoría de uno no vale para el otro; el estado conserva si estaba pendiente;
  // y una descripción que era una opción de la lista del otro tipo pasa a texto libre.
  function cambiarTipo(tipo) {
    setForm(f => {
      if (f.tipo === tipo) return f
      const nuevaLista = tipo === 'Egreso' ? DESCRIPCIONES_EGRESO : DESCRIPCIONES_INGRESO
      const textoActual = f.descripcionPreset === OTRO_VALUE ? f.descripcionLibre : f.descripcionPreset
      const sigueEnLista = nuevaLista.includes(f.descripcionPreset)
      return {
        ...f,
        tipo,
        categoria: '',
        estado: f.estado === 'Pendiente' ? 'Pendiente' : (tipo === 'Egreso' ? 'Pagado' : 'Cobrado'),
        descripcionPreset: sigueEnLista || !textoActual ? f.descripcionPreset : OTRO_VALUE,
        descripcionLibre: sigueEnLista || !textoActual ? f.descripcionLibre : textoActual,
      }
    })
  }

  // ── Cuotas (solo al crear un ingreso de categoría "Cuota") ──
  const cantidadCuotas = Math.trunc(Number(form.cuotaCantidad))
  const mostrarCuotas = !editando && esIngreso && form.categoria === 'cuota'
  const hayPlan = mostrarCuotas && cantidadCuotas > 1
  const montoNum = parseFloat(form.monto)

  const plan = useMemo(() => {
    if (!hayPlan) return null
    try {
      return planDeCuotas({
        total: montoNum,
        cantidad: cantidadCuotas,
        primerVencimiento: esFechaIso(form.cuotaPrimerVencimiento) ? form.cuotaPrimerVencimiento : hoyIso(),
        primeraCobrada: form.cuotaPrimeraCobrada,
      })
    } catch {
      return null
    }
  }, [hayPlan, montoNum, cantidadCuotas, form.cuotaPrimerVencimiento, form.cuotaPrimeraCobrada])

  const handleSubmit = (e) => {
    e.preventDefault()
    setValidationError(null)

    const descripcion = (esOtraDescripcion ? form.descripcionLibre : form.descripcionPreset).trim()
    if (!descripcion) {
      setValidationError('La descripción es obligatoria.')
      return
    }

    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      setValidationError('Ingresá un monto válido mayor a 0.')
      return
    }

    if (editando) {
      onGuardar(cambiosDeEdicion(descripcion))
      return
    }

    if (mostrarCuotas && (!Number.isInteger(cantidadCuotas) || cantidadCuotas < 1 || cantidadCuotas > MAX_CUOTAS)) {
      setValidationError(`La cantidad de cuotas va de 1 a ${MAX_CUOTAS}.`)
      return
    }
    if (hayPlan && !esFechaIso(form.cuotaPrimerVencimiento)) {
      setValidationError('Elegí el vencimiento de la primera cuota.')
      return
    }

    const contraparte = form.contraparte.trim()
    const payload = {
      tipo: form.tipo,
      descripcion,
      monto: montoNum,
      moneda: form.moneda,
      metodoPago: form.metodoPago,
      estado: form.estado,
      categoria: form.categoria,
      paciente: esIngreso ? contraparte : '',
      proveedor: esIngreso ? '' : contraparte,
      profesional: esIngreso ? form.profesional.trim() : '',
      tratamiento: esIngreso ? form.tratamiento.trim() : '',
      fechaPrestacion: form.fechaPrestacion,
      fechaVencimiento: form.fechaVencimiento,
    }
    if (hayPlan) {
      payload.cuotas = {
        cantidad: cantidadCuotas,
        primeraCobrada: form.cuotaPrimeraCobrada,
        primerVencimiento: form.cuotaPrimerVencimiento,
      }
    }
    onGuardar(payload)
  }

  // En edición solo viaja lo que el usuario cambió.
  function cambiosDeEdicion(descripcion) {
    const orig = formularioDesde(inicial)
    const cambios = {}
    if (form.tipo !== orig.tipo) cambios.tipo = form.tipo
    if (descripcion !== (inicial.descripcion || '')) cambios.descripcion = descripcion
    if (montoNum !== Number(orig.monto)) cambios.monto = montoNum
    if (form.moneda !== orig.moneda) cambios.moneda = form.moneda
    if (form.estado !== orig.estado) cambios.estado = form.estado
    if (form.metodoPago !== orig.metodoPago) cambios.metodoPago = form.metodoPago
    if (form.categoria !== orig.categoria) cambios.categoria = form.categoria
    const contraparte = form.contraparte.trim()
    if (form.tipo !== orig.tipo || contraparte !== orig.contraparte) {
      cambios.paciente = esIngreso ? contraparte : ''
      cambios.proveedor = esIngreso ? '' : contraparte
    }
    if (form.profesional.trim() !== orig.profesional) cambios.profesional = form.profesional.trim()
    if (form.tratamiento.trim() !== orig.tratamiento) cambios.tratamiento = form.tratamiento.trim()
    if (form.fecha && form.fecha !== orig.fecha) cambios.fecha = form.fecha
    if (form.fechaPrestacion !== orig.fechaPrestacion) cambios.fechaPrestacion = form.fechaPrestacion
    if (form.fechaVencimiento !== orig.fechaVencimiento) cambios.fechaVencimiento = form.fechaVencimiento
    return cambios
  }

  const mensajeError = validationError || error

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">{editando ? 'Editar movimiento' : 'Nuevo movimiento'}</h2>

        <form onSubmit={handleSubmit} className="modal-form">
          {/* Tipo */}
          <div>
            <label className="form-label">Tipo</label>
            <div className="seg-group">
              <Seg active={esIngreso} onClick={() => cambiarTipo('Ingreso')}>↑ Ingreso</Seg>
              <Seg active={!esIngreso} onClick={() => cambiarTipo('Egreso')}>↓ Egreso</Seg>
            </div>
          </div>

          <div>
            <label className="form-label">Descripción *</label>
            <select className="form-input" value={form.descripcionPreset} onChange={update('descripcionPreset')} autoFocus={!editando}>
              <option value="" disabled>Seleccioná una opción</option>
              {descripciones.map(d => <option key={d} value={d}>{d}</option>)}
              <option value={OTRO_VALUE}>Otro/s...</option>
            </select>
            {esOtraDescripcion && (
              <input className="form-input" style={{ marginTop: 8 }} value={form.descripcionLibre} onChange={update('descripcionLibre')} placeholder="Escribí la descripción" maxLength={200} required autoFocus />
            )}
          </div>

          <div>
            <label className="form-label">{esIngreso ? 'Paciente' : 'Proveedor'}</label>
            <input className="form-input" value={form.contraparte} onChange={update('contraparte')} placeholder={esIngreso ? 'Ej: García, L.' : 'Ej: MediSupply'} maxLength={100} />
          </div>

          {esIngreso && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="form-label">Profesional</label>
                {opcionesProfesional ? (
                  <select className="form-input" value={form.profesional} onChange={update('profesional')}>
                    <option value="">Sin asignar</option>
                    {opcionesProfesional.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <input className="form-input" value={form.profesional} onChange={update('profesional')} placeholder="Ej: Laura" maxLength={100} />
                )}
              </div>
              <div>
                <label className="form-label">Tratamiento</label>
                <input className="form-input" value={form.tratamiento} onChange={update('tratamiento')} placeholder="Ej: Ortodoncia" maxLength={100} />
              </div>
              <div style={{ gridColumn: '1 / -1', marginTop: -8 }}>
                <Hint>El profesional se usa en el reporte por profesional (/por_profesional).</Hint>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Moneda</label>
              <div className="seg-group">
                {['Pesos','Dólares','Euros'].map(m => (
                  <Seg key={m} active={form.moneda === m} onClick={() => setForm(f => ({ ...f, moneda: m }))}>
                    {m === 'Pesos' ? 'ARS' : m === 'Dólares' ? 'USD' : 'EUR'}
                  </Seg>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">{hayPlan ? 'Monto total *' : 'Monto *'}</label>
              <input className="form-input" type="number" step="0.01" min="0.01" placeholder="0" value={form.monto} onChange={update('monto')} required />
            </div>
          </div>

          {!hayPlan && (
            <div>
              <label className="form-label">Estado</label>
              <div className="seg-group">
                {esIngreso
                  ? (<><Seg active={form.estado === 'Cobrado'}   onClick={() => setForm(f => ({ ...f, estado: 'Cobrado' }))}>Cobrado</Seg>
                        <Seg active={form.estado === 'Pendiente'} onClick={() => setForm(f => ({ ...f, estado: 'Pendiente' }))}>Pendiente</Seg></>)
                  : (<><Seg active={form.estado === 'Pagado'}    onClick={() => setForm(f => ({ ...f, estado: 'Pagado' }))}>Pagado</Seg>
                        <Seg active={form.estado === 'Pendiente'} onClick={() => setForm(f => ({ ...f, estado: 'Pendiente' }))}>Pendiente</Seg></>)
                }
              </div>
              {esPendiente && <Hint>Pendiente = todavía no se {esIngreso ? 'cobró' : 'pagó'}. Aparece en los pendientes hasta que lo marques.</Hint>}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Método de pago</label>
              <select className="form-input" value={form.metodoPago} onChange={update('metodoPago')}>
                <option value="">Sin especificar</option>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
              </select>
            </div>
            <div>
              <label className="form-label">Categoría</label>
              <select className="form-input" value={form.categoria} onChange={update('categoria')}>
                {categorias.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          {/* Plan de cuotas */}
          {mostrarCuotas && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, display: 'grid', gap: 12, background: 'var(--surface)' }}>
              <div>
                <label className="form-label">¿En cuántas cuotas?</label>
                <input
                  className="form-input"
                  type="number"
                  min="1"
                  max={MAX_CUOTAS}
                  step="1"
                  value={form.cuotaCantidad}
                  onChange={update('cuotaCantidad')}
                  style={{ maxWidth: 120 }}
                />
                <Hint>El monto de arriba es el total y se reparte en partes iguales, una por mes. Con 1 se carga un solo pago.</Hint>
              </div>

              {hayPlan && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={form.cuotaPrimeraCobrada} onChange={e => setForm(f => ({ ...f, cuotaPrimeraCobrada: e.target.checked }))} />
                    La primera cuota ya está cobrada
                  </label>
                  <div>
                    <label className="form-label">Vencimiento de la primera cuota</label>
                    <input className="form-input" type="date" value={form.cuotaPrimerVencimiento} onChange={update('cuotaPrimerVencimiento')} style={{ maxWidth: 180 }} />
                    <Hint>Las siguientes vencen el mismo día de cada mes.</Hint>
                  </div>
                  {plan ? (
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
                      <strong>Se van a crear {plan.length} cuotas</strong> de {formatMontoConMoneda(plan[0].monto, form.moneda)}
                      {plan[plan.length - 1].monto !== plan[0].monto && <> (la última, de {formatMontoConMoneda(plan[plan.length - 1].monto, form.moneda)})</>}
                      , total {formatMontoConMoneda(montoNum, form.moneda)}.
                      <br />
                      {form.cuotaPrimeraCobrada ? `1ª cobrada hoy y ${plan.length - 1} pendientes` : `Las ${plan.length} quedan pendientes`}:{' '}
                      {plan.filter(c => c.estado === 'Pendiente').slice(0, 3).map(c => `${c.numero}ª vence ${fechaCorta(c.vencimiento)}`).join(' · ')}
                      {plan.filter(c => c.estado === 'Pendiente').length > 3 && ` · …y ${plan.filter(c => c.estado === 'Pendiente').length - 3} más`}.
                    </div>
                  ) : (
                    <Hint>Ingresá el monto total para ver el detalle de las cuotas.</Hint>
                  )}
                </>
              )}
            </div>
          )}

          {editando && (
            <div>
              <label className="form-label">Fecha del movimiento</label>
              <input className="form-input" type="date" value={form.fecha} onChange={update('fecha')} style={{ maxWidth: 200 }} />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Fecha de prestación</label>
              <input className="form-input" type="date" value={form.fechaPrestacion} onChange={update('fechaPrestacion')} />
              <Hint>Cuándo se hizo el trabajo, si no fue hoy.</Hint>
            </div>
            {esPendiente && !hayPlan && (
              <div>
                <label className="form-label">Vencimiento</label>
                <input className="form-input" type="date" value={form.fechaVencimiento} onChange={update('fechaVencimiento')} />
                <Hint>Hasta cuándo debería {esIngreso ? 'cobrarse' : 'pagarse'}.</Hint>
              </div>
            )}
          </div>

          {mensajeError && <div className="error-box">{mensajeError}</div>}

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : hayPlan ? `Crear ${cantidadCuotas} cuotas` : 'Guardar movimiento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
