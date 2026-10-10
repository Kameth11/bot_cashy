// Prepara lo que se adjunta al chat: los PDF van tal cual y las fotos grandes
// (las del celular pesan 4–12 MB, y el tope del servidor es 10 MB) se achican a
// un lado máximo de 2000 px en JPEG. Para leer una factura o una transferencia
// sobra; y la subida por datos móviles se vuelve mucho más rápida.

export const MAX_ARCHIVO_BYTES = 10 * 1024 * 1024
const MAX_LADO = 2000
const UMBRAL_REDUCIR_BYTES = 2 * 1024 * 1024
const TIPOS_DIRECTOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

export class ArchivoNoSoportado extends Error {}

function aBlob(canvas, tipo, calidad) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo convertir'))), tipo, calidad)
  })
}

async function achicar(file) {
  // 'from-image' respeta la orientación EXIF: sin esto las fotos del celular
  // salen acostadas.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * escala))
    canvas.height = Math.max(1, Math.round(bitmap.height * escala))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff' // los PNG con transparencia no quedan negros en JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await aBlob(canvas, 'image/jpeg', 0.85)
  } finally {
    bitmap.close?.()
  }
}

// Devuelve { blob, mime, nombre } o lanza ArchivoNoSoportado con un mensaje
// listo para mostrar.
export async function prepararArchivo(file) {
  const nombre = file.name || ''
  if (file.type === 'application/pdf') {
    if (file.size > MAX_ARCHIVO_BYTES) throw new ArchivoNoSoportado('El PDF pesa más de 10 MB')
    return { blob: file, mime: 'application/pdf', nombre }
  }
  if (!file.type.startsWith('image/')) {
    throw new ArchivoNoSoportado('Mandá una foto o un PDF')
  }

  const hayQueReducir = file.size > UMBRAL_REDUCIR_BYTES || !TIPOS_DIRECTOS.includes(file.type)
  if (!hayQueReducir) return { blob: file, mime: file.type, nombre }
  try {
    const blob = await achicar(file)
    return { blob, mime: 'image/jpeg', nombre: nombre.replace(/\.[^.]+$/, '') + '.jpg' }
  } catch {
    // Si no se pudo achicar pero igual es un formato válido y entra, va tal cual.
    if (TIPOS_DIRECTOS.includes(file.type) && file.size <= MAX_ARCHIVO_BYTES) {
      return { blob: file, mime: file.type, nombre }
    }
    throw new ArchivoNoSoportado('No pude leer esa imagen. Probá con otra foto')
  }
}
