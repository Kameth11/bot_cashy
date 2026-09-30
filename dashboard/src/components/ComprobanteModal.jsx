import { useEffect, useState } from 'react'
import { api } from '../services/api'
import { formatMontoConMoneda } from '../utils/format'

// Detalle de un comprobante (factura, ticket o transferencia leído de una
// foto/PDF) con el archivo original. El archivo se pide a la API (que chequea
// permisos) y se muestra como blob: no hay URLs públicas del bucket.
export default function ComprobanteModal({ comprobante: c, onCerrar }) {
  const [archivoUrl, setArchivoUrl] = useState(null)
  const [archivoError, setArchivoError] = useState(null)
  const [cargando, setCargando] = useState(false)
  const esPdf = c.mimeType === 'application/pdf'

  useEffect(() => {
    if (!c.tieneArchivo) return
    let url = null
    let activo = true
    setCargando(true)
    api.get(`/api/comprobantes/${encodeURIComponent(c.id)}/archivo`, { responseType: 'blob' })
      .then(({ data }) => {
        if (!activo) return
        url = URL.createObjectURL(data)
        setArchivoUrl(url)
      })
      .catch(() => { if (activo) setArchivoError('No se pudo cargar el archivo') })
      .finally(() => { if (activo) setCargando(false) })
    return () => {
      activo = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [c.id, c.tieneArchivo])

  const titulo = c.tipo === 'transferencia' ? 'Comprobante de transferencia' : (c.tipoComprobante || 'Comprobante')
  const filas = [
    [c.tipo === 'transferencia' ? 'Pagador' : 'Emisor', c.emisor],
    ['CUIT', c.cuit],
    [c.tipo === 'transferencia' ? 'N° de operación' : 'Número', c.numero],
    ['Fecha', c.fechaEmision],
    ['Vence', c.fechaVencimiento],
    ['Total', c.total ? formatMontoConMoneda(c.total, c.moneda) : null],
    ['Cargado', c.fechaCarga],
  ].filter(([, v]) => v)

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal" style={{ width: '100%', maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <h2 className="modal-title" style={{ marginBottom: 16, textTransform: 'capitalize' }}>🧾 {titulo}</h2>

        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 14, margin: 0 }}>
          {filas.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt style={{ color: 'var(--text-3)' }}>{k}</dt>
              <dd style={{ margin: 0, color: 'var(--text)', wordBreak: 'break-word' }}>{v}</dd>
            </div>
          ))}
        </dl>

        {Array.isArray(c.items) && c.items.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Ítems ({c.items.length})
            </div>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                {c.items.map((it, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 0' }}>{it.descripcion || '—'}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{it.cantidad ? `× ${it.cantidad}` : ''}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{it.subtotal ? formatMontoConMoneda(it.subtotal, c.moneda) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          {!c.tieneArchivo && <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Este comprobante no tiene el archivo guardado.</p>}
          {cargando && <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Cargando archivo…</p>}
          {archivoError && <p style={{ fontSize: 13, color: 'var(--red)' }}>{archivoError}</p>}
          {archivoUrl && !esPdf && (
            <a href={archivoUrl} target="_blank" rel="noreferrer">
              <img src={archivoUrl} alt="Comprobante" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
            </a>
          )}
          {archivoUrl && esPdf && (
            <a className="btn-secondary" href={archivoUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', textDecoration: 'none' }}>
              📄 Abrir PDF
            </a>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}
