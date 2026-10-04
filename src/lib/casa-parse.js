// Parseo de texto para los comandos de CASA. Funciones puras, sin I/O.

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

// "5000", "5.000", "5.000,50", "5,5", "$ 80k", "1.5k" -> número o null
function parsearMontoTexto(texto) {
  let s = String(texto == null ? '' : texto).trim().toLowerCase().replace(/[$\s]/g, '');
  if (!s) return null;

  let mult = 1;
  if (/k$/.test(s)) { mult = 1000; s = s.slice(0, -1); }
  else if (/mil$/.test(s)) { mult = 1000; s = s.slice(0, -3); }
  if (!/^[\d.,]+$/.test(s)) return null;

  const coma = s.lastIndexOf(',');
  const punto = s.lastIndexOf('.');
  if (coma > punto) s = s.replace(/\./g, '').replace(',', '.');        // 1.234,50
  else if (punto > coma && coma !== -1) s = s.replace(/,/g, '');        // 1,234.50
  else if (coma === -1 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 5.000
  else s = s.replace(',', '.');                                          // 5,5

  const n = Number(s) * mult;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// Token de moneda -> 'Pesos' | 'Dólares' | 'Euros' | null (si no es una moneda)
function parsearMoneda(token) {
  const t = normalizar(token).replace(/[$.]/g, '');
  if (['usd', 'us', 'u', 'dolar', 'dolares', 'dol'].includes(t)) return 'Dólares';
  if (['eur', 'euro', 'euros', '€'].includes(t) || String(token).trim() === '€') return 'Euros';
  if (['ars', 'peso', 'pesos', ''].includes(t) && normalizar(token) !== '') return 'Pesos';
  return null;
}

/**
 * Busca un miembro por nombre: coincidencia exacta (sin tildes ni mayúsculas) o
 * por prefijo único. Si hay más de un candidato NO adivina.
 * @returns {{miembro}|{error:'no_encontrado'|'ambiguo', candidatos?:Array}}
 */
function buscarMiembro(miembros, texto) {
  const q = normalizar(texto);
  if (!q) return { error: 'no_encontrado' };
  const lista = miembros || [];

  const exactos = lista.filter((m) => normalizar(m.nombre) === q);
  if (exactos.length === 1) return { miembro: exactos[0] };
  if (exactos.length > 1) return { error: 'ambiguo', candidatos: exactos };

  const prefijo = lista.filter((m) => normalizar(m.nombre).startsWith(q));
  if (prefijo.length === 1) return { miembro: prefijo[0] };
  if (prefijo.length > 1) return { error: 'ambiguo', candidatos: prefijo };
  return { error: 'no_encontrado' };
}

// Igual que buscarMiembro pero sobre las casas del usuario ({casaId, nombre}).
function buscarCasa(casas, texto) {
  const r = buscarMiembro((casas || []).map((c) => ({ ...c, id: c.casaId })), texto);
  if (r.miembro) return { casa: casas.find((c) => c.casaId === r.miembro.casaId) };
  return r.candidatos ? { error: r.error, candidatos: r.candidatos } : { error: r.error };
}

/**
 * "Ana 5000" | "Hijo Tomás 5.000 usd" | "5000 Ana" -> { nombre, monto, moneda }
 * El monto es el último token numérico; la moneda, un token de moneda al final.
 */
function parsearSaldar(texto) {
  const tokens = String(texto || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  let moneda = 'Pesos';
  const ultimo = parsearMoneda(tokens[tokens.length - 1]);
  if (ultimo && tokens.length >= 3 && parsearMontoTexto(tokens[tokens.length - 1]) === null) {
    moneda = ultimo;
    tokens.pop();
  }

  let idx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (parsearMontoTexto(tokens[i]) !== null) { idx = i; break; }
  }
  if (idx === -1) return null;

  const monto = parsearMontoTexto(tokens[idx]);
  const nombre = tokens.filter((_, i) => i !== idx).join(' ').replace(/^(?:a|le)\s+/i, '').trim();
  return nombre ? { nombre, monto, moneda } : null;
}

module.exports = { parsearMontoTexto, parsearMoneda, buscarMiembro, buscarCasa, parsearSaldar, normalizar };
