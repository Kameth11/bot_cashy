import { useEffect, useState } from 'react'
import { api } from '../services/api'
import { formatMontoConMoneda, etiquetaCategoria } from '../utils/format'
import { CATEGORIAS_EGRESO, CATEGORIAS_INGRESO } from './NuevoMovimientoModal'

// Subir una foto o PDF de un comprobante desde el dashboard (fase 4 de
// PLAN_COMPROBANTES.md). Mismo flujo que en Telegram: se lee con IA, el
// usuario revisa/corrige y recién ahí se guarda el movimiento + comprobante.

const MAX_BYTES = 10 * 1024 * 1024
const TIPOS_ACEPTADOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

function Seg({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className={`seg-btn${active ? ' active' : ''}`}>{children}</button>
  )
}

export default function SubirComprobanteModal({ ambitoInicial = 'consultorio', onGuardado, onCerrar }) {
  const [tipo, setTipo] = useState('factura')
  const [archivo, setArchivo] = useState(null)
  const [leyendo, setLeyendo] = useState(false)
  const [leido, setLeido] = useState(null)
  const [form, setForm] = useState(null)
  const [cobrar, setCobrar] = useState('')
  const [catPersonal, setCatPersonal] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const personal = form?.ambito === 'personal'

  useEffect(() => {
    if (!personal || catPersonal) return
    api.get('/api/personal/categorias').then(({ data }) => setCatPersonal(data?.egreso || [])).catch(() => setCatPersonal([]))
  }, [personal, catPersonal])

  function elegirArchivo(e) {
    setError(null)
    const f = e.target.files && e.target.files[0]
    if (!f) return
    if (!TIPOS_ACEPTADOS.includes(f.type)) { setError('Elegí una foto (JPG, PNG, WEBP) o un PDF.'); return }
    if (f.size > MAX_BYTES) { setError('El archivo pesa más de 10 MB.'); return }
    setArchivo(f)
  }

  async function leer() {
    if (!archivo) return
    setError(null)
    setLeyendo(true)
    try {
      const { data } = await api.post(`/api/comprobantes/leer?tipo=${tipo}`, archivo, {
        headers: { 'Content-Type': archivo.type },
        timeout: 90000,
      })
      setLeido(data)
      const s = data.sugerido || {}
      setForm({ ...s, monto: String(s.monto || ''), ambito: data.puedePersonal && ambitoInicial === 'personal' ? 'personal' : s.ambito })
      setCobrar(data.pendientes?.[0]?.idUnico || '')
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudo leer el comprobante.')
    } finally {
      setLeyendo(false)
    }
  }

  async function guardar(e) {
    e.preventDefault()
    setError(null)
    const montoNum = parseFloat(form.monto)
    if (!form.descripcion?.trim()) { setError('La descripción es obligatoria.'); return }
    if (!Number.isFinite(montoNum) || montoNum <= 0) { setError('Ingresá un monto válido mayor a 0.'); return }
    setGuardando(true)
    try {
      const { data } = await api.post('/api/comprobantes', {
        idComprobante: leido.idComprobante,
        cobrarIdUnico: leido.tipo === 'transferencia' && cobrar ? cobrar : undefined,
        movimiento: { ...form, descripcion: form.descripcion.trim(), monto: montoNum },
      })
      onGuardado?.(data)
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  const set = (campo) => (e) => setForm(f => ({ ...f, [campo]: e.target.value }))
  const c = leido?.comprobante
  const esTransferencia = leido?.tipo === 'transferencia'
  const categorias = personal
    ? [{ value: '', label: 'Sin categoría' }, ...(catPersonal || []).map(v => ({ value: v, label: etiquetaCategoria(v) }))]
    : (esTransferencia ? CATEGORIAS_INGRESO : CATEGORIAS_EGRESO)

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal" style={{ width: '100%', maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">📷 Subir comprobante</h2>

        {!leido && (
          <div className="modal-form">
            <div>
              <label className="form-label">¿Qué es?</label>
              <div className="seg-group">
                <Seg active={tipo === 'factura'} onClick={() => setTipo('factura')}>🧾 Gasto (factura/ticket)</Seg>
                <Seg active={tipo === 'transferencia'} onClick={() => setTipo('transferencia')}>💸 Cobro (transferencia)</Seg>
              </div>
            </div>
            <div>
              <label className="form-label">Foto o PDF</label>
              <input className="form-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={elegirArchivo} />
              {archivo && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{archivo.name} · {Math.round(archivo.size / 1024)} KB</div>}
            </div>
            {error && <div className="error-box">{error}</div>}
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={onCerrar}>Cancelar</button>
              <button type="button" className="btn-primary" disabled={!archivo || leyendo} onClick={leer}>
                {leyendo ? 'Leyendo…' : 'Leer comprobante'}
              </button>
            </div>
          </div>
        )}

        {leido && form && (
          <form className="modal-form" onSubmit={guardar}>
            <div style={{ fontSize: 13, background: 'var(--surface)', borderRadius: 8, padding: '10px 12px', lineHeight: 1.6 }}>
              <strong style={{ textTransform: 'capitalize' }}>{esTransferencia ? 'Transferencia' : [c.tipoDocumento, c.letra].filter(Boolean).join(' ')}</strong>
              {c.numero && <> · {c.numero}</>}
              {c.emisor && <div>{esTransferencia ? 'De' : 'Emisor'}: {c.emisor}{c.cuit ? ` (CUIT ${c.cuit})` : ''}</div>}
              {c.fechaEmision && <div>Fecha: {c.fechaEmision}</div>}
              {Array.isArray(c.items) && c.items.length > 0 && <div>Ítems leídos: {c.items.length}</div>}
            </div>

            {c.duplicado && (
              <div className="error-box" style={{ background: '#FFFAE6', color: '#7A5A00', borderColor: '#FFE380' }}>
                ⚠️ {c.duplicado.motivo === 'mismo_archivo' ? 'Este mismo archivo ya se cargó' : 'Ya hay un comprobante con el mismo emisor, número y total'}
                {c.duplicado.fechaCarga ? ` (el ${c.duplicado.fechaCarga})` : ''}. Revisá que no sea el mismo.
              </div>
            )}

            {esTransferencia && leido.pendientes?.length > 0 && (
              <div>
                <label className="form-label">¿Qué cobra esta transferencia?</label>
                <div style={{ display: 'grid', gap: 6 }}>
                  {leido.pendientes.map(p => (
                    <label key={p.idUnico} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                      <input type="radio" name="cobrar" checked={cobrar === p.idUnico} onChange={() => setCobrar(p.idUnico)} />
                      Pendiente: {p.descripcion} · {formatMontoConMoneda(p.monto, p.moneda)}{p.fecha ? ` (${p.fecha})` : ''}
                    </label>
                  ))}
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                    <input type="radio" name="cobrar" checked={cobrar === ''} onChange={() => setCobrar('')} />
                    Es un ingreso nuevo
                  </label>
                </div>
              </div>
            )}

            {leido.puedePersonal && (
              <div>
                <label className="form-label">Ámbito</label>
                <div className="seg-group">
                  <Seg active={!personal} onClick={() => setForm(f => ({ ...f, ambito: 'consultorio', categoria: '' }))}>🏥 Consultorio</Seg>
                  <Seg active={personal} onClick={() => setForm(f => ({ ...f, ambito: 'personal', categoria: '' }))}>🏠 Personal</Seg>
                </div>
              </div>
            )}

            {!(esTransferencia && cobrar) && (
              <>
                <div>
                  <label className="form-label">Descripción *</label>
                  <input className="form-input" value={form.descripcion} onChange={set('descripcion')} maxLength={200} required />
                </div>
                {!personal && (
                  <div>
                    <label className="form-label">{esTransferencia ? 'Paciente' : 'Proveedor'}</label>
                    <input className="form-input" value={esTransferencia ? form.paciente : form.proveedor} onChange={set(esTransferencia ? 'paciente' : 'proveedor')} maxLength={100} />
                  </div>
                )}
              </>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="form-label">Moneda</label>
                <div className="seg-group">
                  {['Pesos', 'Dólares'].map(m => (
                    <Seg key={m} active={form.moneda === m} onClick={() => setForm(f => ({ ...f, moneda: m }))}>{m === 'Pesos' ? 'ARS' : 'USD'}</Seg>
                  ))}
                </div>
              </div>
              <div>
                <label className="form-label">Monto *</label>
                <input className="form-input" type="number" step="0.01" min="0.01" value={form.monto} onChange={set('monto')} required />
              </div>
            </div>

            {esTransferencia && cobrar && (() => {
              const p = leido.pendientes.find(x => x.idUnico === cobrar)
              const monto = parseFloat(form.monto)
              if (!p || !Number.isFinite(monto)) return null
              if (monto < p.monto) return <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Cobro parcial: queda pendiente {formatMontoConMoneda(p.monto - monto, p.moneda)}.</div>
              if (monto > p.monto) return <div style={{ fontSize: 13, color: 'var(--text-3)' }}>La transferencia es mayor al pendiente: se cobra todo y sobran {formatMontoConMoneda(monto - p.monto, p.moneda)}.</div>
              return null
            })()}

            {!(esTransferencia && cobrar) && (
              <>
                {!esTransferencia && !personal && (
                  <div>
                    <label className="form-label">Estado</label>
                    <div className="seg-group">
                      <Seg active={form.estado !== 'Pendiente'} onClick={() => setForm(f => ({ ...f, estado: 'Cobrado' }))}>Pagado</Seg>
                      <Seg active={form.estado === 'Pendiente'} onClick={() => setForm(f => ({ ...f, estado: 'Pendiente' }))}>Pendiente</Seg>
                    </div>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="form-label">Método de pago</label>
                    <select className="form-input" value={form.metodoPago} onChange={set('metodoPago')}>
                      <option value="">Sin especificar</option>
                      <option value="efectivo">Efectivo</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="tarjeta">Tarjeta</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Categoría</label>
                    <select className="form-input" value={form.categoria} onChange={set('categoria')}>
                      {categorias.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      {form.categoria && !categorias.some(o => o.value === form.categoria) && (
                        <option value={form.categoria}>{etiquetaCategoria(form.categoria)}</option>
                      )}
                    </select>
                  </div>
                </div>
                {!esTransferencia && !personal && form.estado === 'Pendiente' && (
                  <div>
                    <label className="form-label">Vencimiento</label>
                    <input className="form-input" type="date" value={form.fechaVencimiento || ''} onChange={set('fechaVencimiento')} />
                  </div>
                )}
              </>
            )}

            {error && <div className="error-box">{error}</div>}

            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={onCerrar}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={guardando}>
                {guardando ? 'Guardando…' : (esTransferencia && cobrar ? 'Cobrar pendiente' : 'Guardar')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
