export default function Proxim({ titulo = 'Próximamente', descripcion = 'Esta sección está en desarrollo.' }) {
  return (
    <div className="proxim-page">
      <h2>{titulo}</h2>
      <p>{descripcion}</p>
    </div>
  )
}
