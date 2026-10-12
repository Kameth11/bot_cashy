// El cálculo de cuotas existe dos veces: src/utils/cuotas.js (servidor, el que manda al guardar) y
// dashboard/src/utils/cuotas.js (vista previa en pantalla). Este script comprueba que den EXACTAMENTE lo mismo.
// Correr después de tocar cualquiera de las dos:  node scripts/verificar-paridad-cuotas.mjs

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const raiz = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const require = createRequire(import.meta.url)
const back = require(path.join(raiz, 'src', 'utils', 'cuotas.js'))
const front = await import(pathToFileURL(path.join(raiz, 'dashboard', 'src', 'utils', 'cuotas.js')).href)

assert.equal(front.MAX_CUOTAS, back.MAX_CUOTAS)

let planes = 0
const totales = [0.01, 0.05, 1, 99.99, 100, 333.33, 1234567.89, 300000, 1e9, 7.77]
const fechas = ['2026-01-31', '2028-01-31', '2026-10-11', '2026-12-31', '2027-03-30']
for (const total of totales) {
  for (let n = 1; n <= back.MAX_CUOTAS; n++) {
    for (const f of fechas) {
      for (const primeraCobrada of [true, false]) {
        const a = front.planDeCuotas({ total, cantidad: n, primerVencimiento: f, primeraCobrada })
        const b = back.planDeCuotas({ total, cantidad: n, primerVencimiento: f, primeraCobrada })
        assert.deepEqual(a, b, `total=${total} cuotas=${n} primer vencimiento=${f}`)
        const suma = a.reduce((s, c) => s + Math.round(c.monto * 100), 0) / 100
        assert.equal(suma, Math.round(total * 100) / 100, `la suma no da el total (total=${total}, n=${n})`)
        planes++
      }
    }
  }
}

for (const invalido of [[0, 3], ['x', 3], [100, 0], [100, 25], [100, 'a']]) {
  const error = (fn) => { try { fn(...invalido); return null } catch (e) { return e.message } }
  const ef = error(front.repartirCuotas)
  const eb = error(back.repartirCuotas)
  assert.ok(ef && ef === eb, `error distinto para ${JSON.stringify(invalido)}: ${ef} vs ${eb}`)
}

console.log(`OK: servidor y pantalla calculan igual (${planes} planes comparados).`)
