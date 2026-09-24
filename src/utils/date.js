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
  horaArgentinaStr,
};
