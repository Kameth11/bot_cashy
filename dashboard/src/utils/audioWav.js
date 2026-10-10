// Convierte lo grabado por el navegador (webm/opus en Chrome y Firefox, mp4/aac
// en Safari) a WAV mono de 16 kHz. WAV es un formato que Gemini documenta como
// soportado y no depende del contenedor que use cada navegador; para voz, 16 kHz
// mono es lo que usa el reconocimiento de todos modos. 120 s ≈ 3,8 MB, dentro
// del tope de audio del bot (5 MB).

const HZ = 16000

function codificarWav(muestras, hz) {
  const datos = new DataView(new ArrayBuffer(44 + muestras.length * 2))
  const texto = (offset, s) => { for (let i = 0; i < s.length; i++) datos.setUint8(offset + i, s.charCodeAt(i)) }
  texto(0, 'RIFF')
  datos.setUint32(4, 36 + muestras.length * 2, true)
  texto(8, 'WAVE')
  texto(12, 'fmt ')
  datos.setUint32(16, 16, true)           // tamaño del bloque fmt
  datos.setUint16(20, 1, true)            // PCM
  datos.setUint16(22, 1, true)            // mono
  datos.setUint32(24, hz, true)
  datos.setUint32(28, hz * 2, true)       // bytes por segundo
  datos.setUint16(32, 2, true)            // bytes por muestra
  datos.setUint16(34, 16, true)           // bits por muestra
  texto(36, 'data')
  datos.setUint32(40, muestras.length * 2, true)
  for (let i = 0; i < muestras.length; i++) {
    const m = Math.max(-1, Math.min(1, muestras[i]))
    datos.setInt16(44 + i * 2, m < 0 ? m * 0x8000 : m * 0x7fff, true)
  }
  return new Blob([datos], { type: 'audio/wav' })
}

export async function blobAWav(blob) {
  const Contexto = window.AudioContext || window.webkitAudioContext
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext
  if (!Contexto || !Offline) throw new Error('Sin Web Audio')

  const bytes = await blob.arrayBuffer()
  const ctx = new Contexto()
  try {
    // Forma con callbacks: la única que entienden los Safari viejos.
    const audio = await new Promise((resolve, reject) => ctx.decodeAudioData(bytes, resolve, reject))
    const offline = new Offline(1, Math.max(1, Math.ceil(audio.duration * HZ)), HZ)
    const fuente = offline.createBufferSource()
    fuente.buffer = audio
    fuente.connect(offline.destination)
    fuente.start()
    const render = await new Promise((resolve, reject) => {
      const p = offline.startRendering(resolve)
      if (p?.then) p.then(resolve, reject)
    })
    return codificarWav(render.getChannelData(0), HZ)
  } finally {
    ctx.close?.()
  }
}
