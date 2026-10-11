import { useEffect } from 'react'

/**
 * Vista de solo lectura con todos los datos de un movimiento. La usan Movimientos,
 * Personal y Casa: cada pantalla arma sus `filas` ([etiqueta, valor]) y las vacías
 * se ocultan. `acciones` son botones extra (ej. ver comprobante); Editar y Borrar
 * aparecen solo si la pantalla pasa el handler.
 */
export default function DetalleMovimientoModal({ titulo, signo, monto, subtitulo, filas, acciones = null, onEditar, onBorrar, onCerrar }) {
  useEffect(() => {
    const alTeclear = (e) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onCerrar])

  const visibles = filas.filter(([, valor]) => valor !== null && valor !== undefined && valor !== '' && valor !== '—')

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal modal-sm detalle-modal" role="dialog" aria-label="Detalle del movimiento" onClick={e => e.stopPropagation()}>
        <div className="detalle-head">
          <h2 className="detalle-titulo">{titulo}</h2>
          <button type="button" className="action-btn" title="Cerrar" onClick={onCerrar}>✕</button>
        </div>

        <div className={`detalle-monto ${signo === 'egreso' ? 'egreso' : signo === 'ingreso' ? 'ingreso' : ''}`}>{monto}</div>
        {subtitulo && <div className="detalle-sub">{subtitulo}</div>}

        <dl className="detalle-lista">
          {visibles.map(([etiqueta, valor]) => (
            <div key={etiqueta} className="detalle-fila">
              <dt>{etiqueta}</dt>
              <dd>{valor}</dd>
            </div>
          ))}
        </dl>

        {(acciones || onEditar || onBorrar) && (
          <div className="modal-footer detalle-footer">
            {acciones}
            {onBorrar && <button type="button" className="btn-danger" onClick={onBorrar}>🗑 Borrar</button>}
            {onEditar && <button type="button" className="btn-primary" onClick={onEditar}>✏️ Editar</button>}
          </div>
        )}
      </div>
    </div>
  )
}
