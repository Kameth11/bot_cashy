import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'

// Registro de profesionales desde el dashboard (el equivalente web de /profesional en el bot).
// Cada persona gestiona el suyo; el dueño, el de todo su equipo. Registrado, el profesional recibe
// los avisos de sus turnos (llegada, turno nuevo, cancelado, no vino) por Telegram y por la campanita/push.

const mensajeDe = (err, porDefecto) => err?.response?.data?.error || porDefecto

function FormProfesional({ miembro, onGuardado }) {
  const reg = miembro.profesional
  const [nombre, setNombre] = useState(reg?.nombre || '')
  const [consultorio, setConsultorio] = useState(reg?.consultorio || '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [exito, setExito] = useState(false)

  const ruta = `/api/profesionales/registro/${miembro.esYo ? 'yo' : miembro.userId}`
  const hayCambios = nombre.trim() !== (reg?.nombre || '') || consultorio.trim() !== (reg?.consultorio || '')

  async function guardar(e) {
    e.preventDefault()
    setError(null)
    setExito(false)
    setGuardando(true)
    try {
      await api.put(ruta, { nombre, consultorio })
      setExito(true)
      onGuardado()
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'))
    } finally {
      setGuardando(false)
    }
  }

  async function darDeBaja() {
    const quien = miembro.esYo ? 'tu registro como profesional' : `el registro de ${reg.nombre}`
    if (!window.confirm(`¿Dar de baja ${quien}? Dejará de recibir avisos de sus turnos.`)) return
    setError(null)
    setGuardando(true)
    try {
      await api.delete(ruta)
      onGuardado()
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo dar de baja'))
      setGuardando(false)
    }
  }

  return (
    <form className="config-card-body modal-form" style={{ borderTop: '1px solid var(--bg)', paddingTop: 14 }} onSubmit={guardar}>
      <div>
        <label className="form-label">Nombre en la agenda *</label>
        <input
          className="form-input"
          value={nombre}
          onChange={e => { setNombre(e.target.value); setExito(false) }}
          placeholder="Ej: Diego o Dra. María López"
          maxLength={60}
          required
        />
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 0' }}>
          Tiene que coincidir con cómo figura en los turnos: así se sabe a quién avisar.
        </p>
      </div>
      <div>
        <label className="form-label">Consultorio (opcional)</label>
        <input
          className="form-input"
          value={consultorio}
          onChange={e => { setConsultorio(e.target.value); setExito(false) }}
          placeholder="Ej: Consultorio 1"
          maxLength={40}
        />
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 0' }}>
          Sirve para que el bot le asigne los turnos al leer una foto de la agenda.
        </p>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="submit" className="btn-primary" style={{ fontSize: 13 }} disabled={guardando || (reg && !hayCambios)}>
          {guardando ? 'Guardando…' : reg ? 'Guardar cambios' : 'Registrar como profesional'}
        </button>
        {reg && (
          <button type="button" className="btn-danger" style={{ fontSize: 13 }} onClick={darDeBaja} disabled={guardando}>
            Dar de baja
          </button>
        )}
        {exito && <span style={{ color: 'var(--success)', fontSize: 13, fontWeight: 600 }}>✓ Guardado</span>}
      </div>
    </form>
  )
}

export default function TabProfesionales() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [expandido, setExpandido] = useState(null)

  const recargar = useCallback(() => {
    return api.get('/api/profesionales/registro')
      .then(res => { setDatos(res.data); setError(null) })
      .catch(err => setError(mensajeDe(err, 'No se pudo cargar el registro de profesionales')))
  }, [])

  useEffect(() => {
    let activo = true
    api.get('/api/profesionales/registro')
      .then(res => { if (activo) setDatos(res.data) })
      .catch(err => { if (activo) setError(mensajeDe(err, 'No se pudo cargar el registro de profesionales')) })
    return () => { activo = false }
  }, [])

  const miembros = datos?.miembros || []
  // Quien todavía no es profesional tiene su formulario abierto: es lo primero que va a querer hacer.
  const abierto = expandido ?? miembros.find(m => m.esYo && !m.profesional)?.userId ?? null

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 14px', lineHeight: 1.5 }}>
        Un profesional registrado recibe un aviso cuando se marca que <strong>llegó su paciente</strong>, y cuando se
        <strong> crea, cancela</strong> o se marca <strong>no vino</strong> un turno suyo: por Telegram y en la
        campanita 🔔 de la web (con push si lo activó en ese dispositivo).
      </p>

      {error && (
        <div className="config-card" style={{ borderColor: 'var(--red)', marginBottom: 12 }}>
          <p style={{ color: 'var(--red)', padding: '12px 16px', margin: 0, fontSize: 13 }}>{error}</p>
        </div>
      )}

      {!datos && !error && <div className="empty-state">Cargando…</div>}

      {miembros.map(m => {
        const abiertoAhora = abierto === m.userId
        return (
          <div key={m.userId} className="config-card">
            <div
              className="config-card-header"
              style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onClick={() => setExpandido(abiertoAhora ? '' : m.userId)}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {m.profesional ? `👨‍⚕️ ${m.profesional.nombre}` : m.etiqueta}
                  {m.profesional && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>{m.etiqueta}</span>}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>
                  {m.profesional
                    ? `Profesional${m.profesional.consultorio ? ` · ${m.profesional.consultorio}` : ''}`
                    : 'Sin registrar como profesional'}
                </span>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{abiertoAhora ? '▲' : '▼'}</span>
            </div>
            {abiertoAhora && (
              // La key hace que el formulario se rearme con los datos nuevos tras guardar o dar de baja.
              <FormProfesional
                key={`${m.userId}:${m.profesional?.nombre || ''}:${m.profesional?.consultorio || ''}`}
                miembro={m}
                onGuardado={recargar}
              />
            )}
          </div>
        )
      })}

      {datos?.puedeGestionar && miembros.length <= 1 && (
        <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
          Para registrar a otro odontólogo, primero tiene que unirse al consultorio: generale un código con /codigo
          en el bot y que escriba <code>/unir CODIGO</code>. Después lo vas a ver acá.
        </p>
      )}
    </>
  )
}
