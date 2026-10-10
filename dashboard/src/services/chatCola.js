// Cola de mensajes del chat que no se pudieron mandar (sin internet). Vive en
// IndexedDB del dispositivo: sobrevive a cerrar la app o recargar, pero no se
// comparte con otros dispositivos. Se vacía sola al volver la conexión.
// Si IndexedDB no está disponible (modo privado), la cola queda en memoria.

const DB_NAME = 'cashy-chat'
const STORE = 'pendientes'

let memoria = []
let dbPromise = null

function abrir() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function tx(db, modo, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, modo)
    const store = t.objectStore(STORE)
    const res = fn(store)
    t.oncomplete = () => resolve(res?.result)
    t.onerror = () => reject(t.error)
  })
}

export async function listarPendientes() {
  const db = await abrir()
  if (!db) return [...memoria]
  try {
    const items = await tx(db, 'readonly', s => s.getAll())
    return (items || []).sort((a, b) => a.ts - b.ts)
  } catch {
    return [...memoria]
  }
}

export async function encolar(item) {
  const completo = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ts: Date.now(), ...item }
  const db = await abrir()
  if (!db) {
    memoria.push(completo)
    return completo
  }
  try {
    await tx(db, 'readwrite', s => s.put(completo))
  } catch {
    memoria.push(completo)
  }
  return completo
}

export async function quitar(id) {
  memoria = memoria.filter(i => i.id !== id)
  const db = await abrir()
  if (!db) return
  try {
    await tx(db, 'readwrite', s => s.delete(id))
  } catch {
    // nada: si no se pudo borrar, se reintenta y el bot lo procesa de nuevo
  }
}
