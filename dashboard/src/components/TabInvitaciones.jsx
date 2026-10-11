import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'
import { PERMISOS_LABELS, PRESET_LABELS } from '../utils/permisos'

// Invitar a una persona al consultorio por su Gmail, sin Telegram. La persona entra al dashboard con
// "Entrar con Google" usando ese mismo email y la cuenta se crea sola, con los permisos que elijas acá
// (y, si querés, como profesional). Solo se pueden dar permisos que uno mismo tiene.

const mensajeDe = (err, porDefecto) => err?.response?.data?.error || porDefecto

const ESTADOS = {
  pendiente: { texto: 'Pendiente', color: 'var(--amber, #FF8B00)' },
  usada:     { texto: 'Ya entró', color: 'var(--green, #006644)' },
  vencida:   { texto: 'Vencida',  color: 'var(--text-3)' },
  revocada:  { texto: 'Revocada', color: 'var(--text-3)' },
}

const fecha = (iso) => new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })

function resumenPermisos(permisos, presets) {
  const ordenados = [...permisos].sort().join(',')
  for (const [nombre, lista] of Object.entries(presets || {})) {
    if ([...lista].sort().join(',') === ordenados) return PRESET_LABELS[nombre] || nombre
  }
  return permisos.map(p => PERMISOS_LABELS[p] || p).join(', ')
}

export default function TabInvitaciones() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)

  const [email, setEmail] = useState('')
  const [permisos, setPermisos] = useState(['ver_agenda'])
  const [esProfesional, setEsProfesional] = useState(false)
  const [profNombre, setProfNombre] = useState('')
  const [profConsultorio, setProfConsultorio] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [formError, setFormError] = useState(null)
  const [creada, setCreada] = useState(null)   // { email, urlIngreso } para mostrar cómo avisarle
  const [copiado, setCopiado] = useState(false)

  const recargar = useCallback(() => {
    return api.get('/api/invitaciones')
      .then(res => { setDatos(res.data); setError(null) })
      .catch(err => setError(mensajeDe(err, 'No se pudieron cargar las invitaciones')))
  }, [])

  useEffect(() => {
    let activo = true
    api.get('/api/invitaciones')
      .then(res => { if (activo) setDatos(res.data) })
      .catch(err => { if (activo) setError(mensajeDe(err, 'No se pudieron cargar las invitaciones')) })
    return () => { activo = false }
  }, [])

  const disponibles = datos?.permisosDisponibles || []

  function alternar(p) {
    setPermisos(prev => (prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]))
  }

  async function invitar(e) {
    e.preventDefault()
    setFormError(null)
    setCreada(null)
    setEnviando(true)
    try {
      const { data } = await api.post('/api/invitaciones', {
        email,
        permisos,
        profesional: esProfesional ? { nombre: profNombre, consultorio: profConsultorio } : undefined,
      })
      setCreada({ email: data.invitacion.email, urlIngreso: data.urlIngreso })
      setEmail('')
      setEsProfesional(false)
      setProfNombre('')
      setProfConsultorio('')
      await recargar()
    } catch (err) {
      setFormError(mensajeDe(err, 'No se pudo crear la invitación'))
    } finally {
      setEnviando(false)
    }
  }

  async function revocar(inv) {
    if (!window.confirm(`¿Revocar la invitación a ${inv.email}? Ya no va a poder entrar con ese link.`)) return
    try {
      await api.delete(`/api/invitaciones/${inv.id}`)
      await recargar()
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo revocar la invitación'))
    }
  }

  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch { /* sin portapapeles: el texto queda visible para copiarlo a mano */ }
  }

  if (error && !datos) {
    return (
      <div className="config-card" style={{ borderColor: 'var(--red)' }}>
        <p style={{ color: 'var(--red)', padding: '12px 16px', margin: 0, fontSize: 13 }}>{error}</p>
      </div>
    )
  }
  if (!datos) return <div className="empty-state">Cargando…</div>

  const presetsDisponibles = Object.entries(datos.presets || {})

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 14px', lineHeight: 1.5 }}>
        Escribí el Gmail de la persona. Cuando entre al dashboard con <strong>“Entrar con Google”</strong> usando ese
        mismo email, se le crea la cuenta con los permisos que elijas, sin necesidad de Telegram. La invitación vale{' '}
        {datos.vigenciaDias} días y se usa una sola vez.
        {!datos.puedeDelegar && ' Solo podés dar permisos que vos tenés.'}
      </p>

      <form className="config-card" onSubmit={invitar}>
        <div className="config-card-header"><h2>Nueva invitación</h2></div>
        <div className="config-card-body modal-form">
          <div>
            <label className="form-label">Email (Gmail) *</label>
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="odontologo@gmail.com"
              maxLength={160}
              required
            />
          </div>

          <div>
            <label className="form-label">Qué puede hacer</label>
            {presetsDisponibles.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Plantilla:</span>
                {presetsDisponibles.map(([nombre, lista]) => (
                  <button
                    key={nombre}
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: 12, padding: '4px 12px' }}
                    onClick={() => setPermisos([...lista])}
                  >
                    {PRESET_LABELS[nombre] || nombre}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {disponibles.map(p => (
                <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={permisos.includes(p)} onChange={() => alternar(p)} />
                  {PERMISOS_LABELS[p] || p}
                </label>
              ))}
            </div>
            {permisos.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '8px 0 0' }}>Sin elegir ninguno, recibe solo “Ver agenda”.</p>
            )}
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={esProfesional} onChange={e => setEsProfesional(e.target.checked)} />
              Es profesional (atiende turnos y recibe avisos)
            </label>
            {esProfesional && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                <div>
                  <label className="form-label">Nombre en la agenda *</label>
                  <input className="form-input" value={profNombre} onChange={e => setProfNombre(e.target.value)} placeholder="Ej: Dra. María López" maxLength={60} required />
                </div>
                <div>
                  <label className="form-label">Consultorio</label>
                  <input className="form-input" value={profConsultorio} onChange={e => setProfConsultorio(e.target.value)} placeholder="Ej: Consultorio 1" maxLength={40} />
                </div>
              </div>
            )}
          </div>

          {formError && <div className="error-box">{formError}</div>}

          <div>
            <button type="submit" className="btn-primary" style={{ fontSize: 13 }} disabled={enviando}>
              {enviando ? 'Invitando…' : 'Invitar'}
            </button>
          </div>
        </div>
      </form>

      {creada && (
        <div className="config-card" style={{ borderColor: 'var(--green, #006644)' }}>
          <div className="config-card-body" style={{ fontSize: 13, lineHeight: 1.6 }}>
            <strong>✓ Invitación creada para {creada.email}.</strong>
            <br />
            Avisale que entre {creada.urlIngreso ? <>a <code>{creada.urlIngreso}</code> </> : 'al dashboard '}
            y toque <strong>“Entrar con Google”</strong> con ese mismo Gmail.
            {creada.urlIngreso && (
              <>
                {' '}
                <button type="button" className="btn-link-inline" onClick={() => copiar(creada.urlIngreso)}>
                  {copiado ? '¡Copiado!' : 'Copiar link'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {error && <div className="error-box" style={{ margin: '12px 0' }}>{error}</div>}

      <h3 style={{ fontSize: 13, color: 'var(--text-2)', margin: '20px 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Invitaciones {datos.puedeDelegar ? 'del consultorio' : 'que hiciste'}
      </h3>

      {datos.invitaciones.length === 0 && (
        <div className="config-card">
          <p style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13, margin: 0 }}>Todavía no invitaste a nadie.</p>
        </div>
      )}

      {datos.invitaciones.map(inv => {
        const estado = ESTADOS[inv.estado] || ESTADOS.pendiente
        return (
          <div key={inv.id} className="config-card">
            <div className="config-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 14, overflowWrap: 'anywhere' }}>{inv.email}</span>
                <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>
                  {resumenPermisos(inv.permisos, datos.presets)}
                  {inv.profesional && ` · 👨‍⚕️ ${inv.profesional.nombre}${inv.profesional.consultorio ? ` (${inv.profesional.consultorio})` : ''}`}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 400 }}>
                  Creada el {fecha(inv.creadaEn)}{inv.estado === 'pendiente' ? ` · vence el ${fecha(inv.expiraEn)}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: estado.color }}>{estado.texto}</span>
                {inv.estado === 'pendiente' && (
                  <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => revocar(inv)}>
                    Revocar
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
