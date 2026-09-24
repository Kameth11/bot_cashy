const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';

// Descompone un instante en sus componentes de calendario/hora EN ARGENTINA,
// sin depender de la zona horaria del proceso (Railway suele correr en UTC).
// `process.env.TZ` también se fija a esta zona en src/index.js, como defensa
// adicional para cualquier código que no pase por acá — pero estas funciones
// no dependen de eso para dar el resultado correcto.
function partesArgentina(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HORARIA,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const partes = {};
  for (const { type, value } of formatter.formatToParts(date)) {
    if (type !== 'literal') partes[type] = value;
  }
  // Con hour12:false, Intl devuelve "24" para la medianoche en vez de "00".
  if (partes.hour === '24') partes.hour = '00';
  return partes;
}

// Reemplazo directo de `new Date()` para los lugares que arman fecha/hora
// "de ahora" leyendo getters locales (getDate/getMonth/getHours/etc.): el
// Date que devuelve siempre representa la hora de Argentina en esos
// getters, sea cual sea la zona horaria real del proceso.
function ahoraArgentina() {
  const p = partesArgentina();
  return new Date(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second)
  );
}

function fechaArgentinaStr(date = new Date()) {
  const p = partesArgentina(date);
  return `${p.day}/${p.month}/${p.year}`;
}

// N días respecto de la fecha actual en Argentina, calculado con aritmética
// UTC pura (Date.UTC) para no depender de la zona horaria del proceso ni de
// reglas de DST al cruzar mes/año.
function fechaEnDiasArgentinaStr(dias) {
  const p = partesArgentina();
  const destino = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + dias));
  const dia = String(destino.getUTCDate()).padStart(2, '0');
  const mes = String(destino.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${destino.getUTCFullYear()}`;
}

function fechaMananaArgentinaStr() {
  return fechaEnDiasArgentinaStr(1);
}

function fechaPasadoMananaArgentinaStr() {
  return fechaEnDiasArgentinaStr(2);
}

// Parsea una fecha escrita a mano por el usuario (DD/MM o DD/MM/AAAA, con "/"
// o "-") al mismo formato "DD/MM/AAAA" que usa fechaArgentinaStr(). Si falta
// el año, asume el año actual en Argentina. Devuelve null si el texto no es
// una fecha válida (incluye chequeo de días fuera de rango para el mes).
function parsearFechaIngresada(texto) {
  if (!texto) return null;
  const match = String(texto).trim().match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (!match) return null;

  const dia = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10);
  let anio = match[3] ? parseInt(match[3], 10) : Number(partesArgentina().year);
  if (match[3] && match[3].length === 2) anio += 2000;

  if (mes < 1 || mes > 12 || dia < 1) return null;
  const diasEnMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  if (dia > diasEnMes) return null;

  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;
}

// Resuelve una referencia libre de día ("hoy", "mañana", "pasado mañana",
// una fecha explícita DD/MM(/AAAA), o null) a "DD/MM/AAAA". Si no reconoce
// el texto (ej. nombre de día de la semana), devuelve hoy con `ambigua:true`
// para que el caller pueda avisarle al usuario en vez de responder callado
// para el día equivocado.
function resolverFechaAgenda(fechaRef) {
  const texto = String(fechaRef || '').trim().toLowerCase();

  if (!texto || texto === 'hoy') {
    return { fecha: fechaArgentinaStr(), ambigua: false };
  }
  if (/^ma(ñ|n)ana$/.test(texto)) {
    return { fecha: fechaMananaArgentinaStr(), ambigua: false };
  }
  if (/^pasado\s*ma(ñ|n)ana$/.test(texto)) {
    return { fecha: fechaPasadoMananaArgentinaStr(), ambigua: false };
  }

  const explicita = parsearFechaIngresada(fechaRef);
  if (explicita) {
    return { fecha: explicita, ambigua: false };
  }

  return { fecha: fechaArgentinaStr(), ambigua: true };
}

function horaArgentinaStr(date = new Date()) {
  const p = partesArgentina(date);
  return `${p.hour}:${p.minute}`;
}

function normalizarFecha(fechaStr) {
  if (!fechaStr) return null;
  const partes = fechaStr.split('/');
  if (partes.length === 3) {
    return new Date(partes[2], partes[1] - 1, partes[0]);
  }
  const date = new Date(fechaStr);
  return isNaN(date.getTime()) ? null : date;
}

function esHoy(fechaStr) {
  const fecha = normalizarFecha(fechaStr);
  if (!fecha) return false;
  const hoy = ahoraArgentina();
  return fecha.getDate() === hoy.getDate() &&
    fecha.getMonth() === hoy.getMonth() &&
    fecha.getFullYear() === hoy.getFullYear();
}

function esEstaSemana(fechaStr) {
  const fecha = normalizarFecha(fechaStr);
  if (!fecha) return false;
  const hoy = ahoraArgentina();
  const inicioSemana = new Date(hoy);
  inicioSemana.setDate(hoy.getDate() - 6);
  return fecha >= inicioSemana && fecha <= hoy;
}

function esEsteMes(fechaStr) {
  const fecha = normalizarFecha(fechaStr);
  if (!fecha) return false;
  const hoy = ahoraArgentina();
  return fecha.getMonth() === hoy.getMonth() &&
    fecha.getFullYear() === hoy.getFullYear();
}

module.exports = {
  normalizarFecha,
  esHoy,
  esEstaSemana,
  esEsteMes,
  ahoraArgentina,
  fechaArgentinaStr,
  fechaMananaArgentinaStr,
  fechaPasadoMananaArgentinaStr,
  fechaEnDiasArgentinaStr,
  parsearFechaIngresada,
  resolverFechaAgenda,
  horaArgentinaStr,
};
