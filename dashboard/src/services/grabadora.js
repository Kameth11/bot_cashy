// Grabación de audio del chat. Una grabación es un objeto con UN solo punto de
// cierre (`cerrar`): sea que el usuario toque enviar/descartar, se llegue al
// máximo, el navegador falle, la app pase a segundo plano o el micrófono lo
// tome otra app, siempre se sueltan el micrófono y los timers y se avisa
// exactamente una vez por `onFin`. Así no puede quedar "grabando" sin forma de
// cortar, ni dos grabaciones a la vez peleándose por el estado.

const MIN_SEGUNDOS = 1
const MIMES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
// Si el navegador no avisa que terminó de grabar, se cierra igual con lo que haya.
const ESPERA_CIERRE_MS = 1500

export function soportaGrabacion() {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

function elegirMime() {
  return MIMES.find(m => MediaRecorder.isTypeSupported?.(m)) || ''
}

// onTick(segundos) cada ~0,25 s mientras graba.
// onFin(resultado), una sola vez, con uno de estos resultados:
//   { blob, mime, duracion }   grabación lista para enviar
//   { descartado: true, corto?: true }
//   { error: 'permiso' | 'grabadora' }
// Devuelve { detener(), descartar() }; ambos se pueden llamar en cualquier
// momento (incluso mientras el navegador todavía pide permiso del micrófono).
export function crearGrabacion({ maxSegundos, onTick, onFin }) {
  const partes = []
  let stream = null
  let recorder = null
  let inicio = 0
  let cerrada = false
  let detenida = false
  let descartada = false
  let timerTick = null
  let timerMax = null
  let timerCierre = null

  function resultadoFinal() {
    const duracion = Math.round((Date.now() - inicio) / 1000)
    if (descartada || !partes.length) return { descartado: true }
    if (duracion < MIN_SEGUNDOS) return { descartado: true, corto: true }
    const mime = (recorder?.mimeType || '').split(';')[0] || 'audio/webm'
    return { blob: new Blob(partes, { type: mime }), mime, duracion }
  }

  function cerrar(resultado) {
    if (cerrada) return
    cerrada = true
    clearInterval(timerTick)
    clearTimeout(timerMax)
    clearTimeout(timerCierre)
    document.removeEventListener('visibilitychange', alCambiarVisibilidad)
    try { stream?.getTracks().forEach(t => t.stop()) } catch { /* ya estaba suelto */ }
    onFin(resultado)
  }

  function detener(descartar = false) {
    if (cerrada) return
    detenida = true
    if (descartar) descartada = true
    // Todavía esperando el permiso del micrófono: se resuelve en cuanto llegue.
    if (!recorder) return
    if (recorder.state === 'recording') {
      try {
        recorder.stop()
      } catch {
        cerrar(resultadoFinal())
        return
      }
      timerCierre = setTimeout(() => cerrar(resultadoFinal()), ESPERA_CIERRE_MS)
    } else {
      cerrar(resultadoFinal())
    }
  }

  // Si la app pasa a segundo plano el navegador puede cortar el micrófono sin
  // avisar: se corta y se manda lo grabado en vez de dejarlo colgado.
  function alCambiarVisibilidad() {
    if (document.hidden) detener(false)
  }

  async function iniciar() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
    } catch {
      cerrar({ error: 'permiso' })
      return
    }
    if (detenida) {
      // Lo cortaron mientras se pedía el permiso: no hay nada que grabar.
      cerrar({ descartado: true })
      return
    }
    try {
      const mime = elegirMime()
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    } catch {
      cerrar({ error: 'grabadora' })
      return
    }
    recorder.ondataavailable = e => { if (e.data?.size) partes.push(e.data) }
    recorder.onstop = () => cerrar(resultadoFinal())
    recorder.onerror = () => cerrar({ error: 'grabadora' })
    // Otra app (una llamada, por ejemplo) se llevó el micrófono.
    stream.getAudioTracks().forEach(t => { t.onended = () => detener(false) })
    document.addEventListener('visibilitychange', alCambiarVisibilidad)

    inicio = Date.now()
    timerTick = setInterval(() => onTick?.(Math.floor((Date.now() - inicio) / 1000)), 250)
    timerMax = setTimeout(() => detener(false), maxSegundos * 1000)
    try {
      // Con timeslice el navegador va entregando datos: aunque el cierre falle,
      // lo grabado hasta ahí no se pierde.
      recorder.start(1000)
    } catch {
      cerrar({ error: 'grabadora' })
    }
  }

  iniciar()

  return {
    detener: () => detener(false),
    descartar: () => detener(true),
  }
}
