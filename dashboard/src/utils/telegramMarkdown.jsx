// Render del Markdown "v1" de Telegram (el que usa el bot: parse_mode
// 'Markdown') como elementos de React, sin innerHTML. Soporta lo mismo que
// Telegram: *negrita*, _cursiva_, `código`, ```bloque``` y [texto](url).
// El bot escapa con barra invertida (escapeMarkdown), así que `\*` es un
// asterisco literal. Un marcador sin cierre se muestra tal cual.

function linkSeguro(url) {
  return /^https?:\/\//i.test(url) ? url : null
}

function buscarCierre(texto, desde, marcador) {
  for (let i = desde; i < texto.length; i++) {
    if (texto[i] === '\\') { i++; continue }
    if (texto.startsWith(marcador, i)) return i
  }
  return -1
}

function sinEscapes(texto) {
  return texto.replace(/\\([_*[\]()`\\])/g, '$1')
}

export function renderTelegramMarkdown(texto) {
  const partes = []
  let plano = ''
  let k = 0
  const cortarPlano = () => {
    if (plano) partes.push(plano)
    plano = ''
  }

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (c === '\\' && i + 1 < texto.length) {
      plano += texto[i + 1]
      i++
      continue
    }
    if (texto.startsWith('```', i)) {
      const fin = texto.indexOf('```', i + 3)
      if (fin > -1) {
        cortarPlano()
        partes.push(<pre key={k++} className="chat-pre">{texto.slice(i + 3, fin).replace(/^\n/, '')}</pre>)
        i = fin + 2
        continue
      }
    }
    if (c === '`') {
      const fin = texto.indexOf('`', i + 1)
      if (fin > -1) {
        cortarPlano()
        partes.push(<code key={k++}>{texto.slice(i + 1, fin)}</code>)
        i = fin
        continue
      }
    }
    if (c === '*' || c === '_') {
      const fin = buscarCierre(texto, i + 1, c)
      if (fin > i + 1) {
        cortarPlano()
        const interior = sinEscapes(texto.slice(i + 1, fin))
        partes.push(c === '*' ? <strong key={k++}>{interior}</strong> : <em key={k++}>{interior}</em>)
        i = fin
        continue
      }
    }
    if (c === '[') {
      const finTexto = buscarCierre(texto, i + 1, ']')
      if (finTexto > -1 && texto[finTexto + 1] === '(') {
        const finUrl = texto.indexOf(')', finTexto + 2)
        const url = finUrl > -1 ? linkSeguro(texto.slice(finTexto + 2, finUrl)) : null
        if (url) {
          cortarPlano()
          partes.push(
            <a key={k++} href={url} target="_blank" rel="noopener noreferrer">
              {sinEscapes(texto.slice(i + 1, finTexto))}
            </a>
          )
          i = finUrl
          continue
        }
      }
    }
    plano += c
  }
  cortarPlano()
  return partes
}
