import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(err) {
    return { error: err }
  }

  componentDidCatch(err, info) {
    console.error('ErrorBoundary caught:', err, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, textAlign: 'center', fontFamily: 'IBM Plex Sans, sans-serif' }}>
          <p style={{ marginBottom: 16, color: '#BF2600' }}>Ocurrió un error inesperado.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '8px 20px', borderRadius: 6, border: '1px solid #DFE1E6', cursor: 'pointer' }}
          >
            Recargar página
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
