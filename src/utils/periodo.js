// Resuelve una expresión de período en español ("ayer", "el mes pasado", "marzo",
// "este año", "últimos 15 días", "del 01/03 al 15/03") a un rango de fechas. Es código
// determinista: la IA solo identifica la frase, el rango lo calcula esto (así una
// suma nunca depende de que el modelo "adivine" fechas).

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NUMEROS = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, diez: 10, quince: 15, veinte: 20, treinta: 30 };

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ddmm = isoStr => { const [y, m, d] = isoStr.split('-'); return `${d}/${m}/${y}`; };
const dia = (hoy, delta) => new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + delta);
const ultimoDiaMes = (y, m0) => new Date(y, m0 + 1, 0);

function normalizar(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function rango(desde, hasta, etiqueta, actual = false) {
  return { desde: iso(desde), hasta: iso(hasta), etiqueta, actual };
}

// `hoy`: Date cuyos getters (getDate/getMonth/...) representan la fecha de Argentina
// (ver ahoraArgentina en utils/date.js). `actual: true` marca los períodos en curso
// (hoy / esta semana / este mes) que el bot ya resuelve con /hoy, /semana y /mes.
function resolverPeriodo(texto, hoy) {
  const t = normalizar(texto);
  if (!t) return null;
  const y = hoy.getFullYear();
  const m = hoy.getMonth();

  let r;

  // Rango explícito: "del 01/03 al 15/03", "desde 01/03/2026 hasta 15/03/2026"
  r = t.match(/(?:del|desde)\s+(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s+(?:al|hasta(?:\s+el)?)\s+(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (r) {
    const anio = v => (v ? (v.length === 2 ? 2000 + Number(v) : Number(v)) : y);
    const a = new Date(anio(r[3]), Number(r[2]) - 1, Number(r[1]));
    const b = new Date(anio(r[6]), Number(r[5]) - 1, Number(r[4]));
    if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime()) && a <= b) {
      return rango(a, b, `del ${pad(a.getDate())}/${pad(a.getMonth() + 1)}/${a.getFullYear()} al ${pad(b.getDate())}/${pad(b.getMonth() + 1)}/${b.getFullYear()}`);
    }
    return null;
  }

  if (/\banteayer\b|\bantes de ayer\b/.test(t)) return rango(dia(hoy, -2), dia(hoy, -2), 'anteayer');
  if (/\bayer\b/.test(t)) return rango(dia(hoy, -1), dia(hoy, -1), 'ayer');

  // "últimos 15 días / 2 semanas / 3 meses" (también "ultimas")
  r = t.match(/\bultim[oa]s?\s+(\d{1,3}|[a-z]+)\s+(dias?|semanas?|mes(?:es)?)\b/);
  if (r) {
    const n = /^\d+$/.test(r[1]) ? Number(r[1]) : NUMEROS[r[1]];
    if (n && n > 0 && n <= 366) {
      const u = r[2];
      if (u.startsWith('dia')) return rango(dia(hoy, -(n - 1)), hoy, `últimos ${n} días`);
      if (u.startsWith('semana')) return rango(dia(hoy, -(n * 7 - 1)), hoy, `últimas ${n} semanas`);
      return rango(new Date(y, m - n, hoy.getDate() + 1), hoy, `últimos ${n} meses`);
    }
    return null;
  }

  if (/\b(?:ano|anio) pasado\b|\b(?:ano|anio) anterior\b/.test(t)) {
    return rango(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31), `año pasado (${y - 1})`);
  }
  if (/\b(?:este|el)\s+(?:ano|anio)\b|\banual\b|\bdel (?:ano|anio)\b/.test(t)) {
    return rango(new Date(y, 0, 1), new Date(y, 11, 31), `este año (${y})`);
  }

  if (/\bsemana pasada\b|\bsemana anterior\b/.test(t)) return rango(dia(hoy, -13), dia(hoy, -7), 'semana pasada');
  if (/\bmes pasado\b|\bmes anterior\b|\bultimo mes\b/.test(t)) {
    const a = new Date(y, m - 1, 1);
    return rango(a, ultimoDiaMes(a.getFullYear(), a.getMonth()), `mes pasado (${MESES[a.getMonth()]} ${a.getFullYear()})`);
  }

  // Nombre de mes, con año opcional: "marzo", "en marzo de 2025"
  for (let i = 0; i < 12; i++) {
    const re = new RegExp(`\\b${MESES[i]}\\b(?:\\s+(?:de|del)?\\s*(\\d{4}))?`);
    r = t.match(re);
    if (r) {
      // Sin año: el último "marzo" que ya empezó (un mes futuro se entiende del año pasado).
      const anio = r[1] ? Number(r[1]) : (i > m ? y - 1 : y);
      return rango(new Date(anio, i, 1), ultimoDiaMes(anio, i), `${MESES[i]} ${anio}`);
    }
  }

  // Períodos en curso (los resuelven /hoy, /semana, /mes; se devuelven marcados `actual`).
  if (/\bhoy\b/.test(t)) return rango(hoy, hoy, 'hoy', true);
  if (/\besta semana\b|\bla semana\b/.test(t)) return rango(dia(hoy, -6), hoy, 'esta semana', true);
  if (/\beste mes\b|\bel mes\b/.test(t)) return rango(new Date(y, m, 1), ultimoDiaMes(y, m), `este mes (${MESES[m]} ${y})`, true);

  return null;
}

module.exports = { resolverPeriodo, ddmm, MESES };
