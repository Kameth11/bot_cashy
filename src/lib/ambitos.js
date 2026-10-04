// Ámbitos en los que se puede registrar un movimiento. Antes eran strings
// sueltos ('personal' / 'consultorio') y todo lo que no fuera 'personal' caía
// en consultorio, así que un valor nuevo (casa) se habría guardado en el
// lugar equivocado sin avisar. Acá hay una sola fuente.

const AMBITO_CONSULTORIO = 'consultorio';
const AMBITO_PERSONAL = 'personal';
const AMBITO_CASA = 'casa';

const AMBITOS = [AMBITO_CONSULTORIO, AMBITO_PERSONAL, AMBITO_CASA];

// Un valor desconocido o ausente es consultorio (comportamiento histórico).
function normalizarAmbito(valor) {
  const v = String(valor || '').trim().toLowerCase();
  return AMBITOS.includes(v) ? v : AMBITO_CONSULTORIO;
}

function esAmbito(entities, ambito) {
  return normalizarAmbito(entities && entities.ambito) === ambito;
}

// Campos que decide marcarAmbito (text.js) y que tienen que llegar INTACTOS a la
// pantalla de confirmación. Cualquier handler que arme el objeto de confirmación
// a mano tiene que copiarlos: si no, la detección de ámbito se pierde en
// silencio y todo termina como consultorio.
const CAMPOS_AMBITO = [
  'ambito', 'ambiguoAmbito', 'terminoAmbito', 'textoOriginal', 'categoriaConsultorio',
  'viajeId', 'viajeNombre', 'casasDisponibles',
  'casaId', 'casaNombre', 'miembrosCasa', 'pagoPorId', 'pagoPorNombre',
  'repartoIds', 'repartoNombres', 'avisoReparto',
];

// Solo copia los campos que existen: un movimiento sin ámbito sigue igual.
function camposDeAmbito(entities) {
  const salida = {};
  for (const campo of CAMPOS_AMBITO) {
    if (entities && entities[campo] !== undefined) salida[campo] = entities[campo];
  }
  return salida;
}

module.exports = {
  CAMPOS_AMBITO,
  camposDeAmbito,
  AMBITO_CONSULTORIO,
  AMBITO_PERSONAL,
  AMBITO_CASA,
  AMBITOS,
  normalizarAmbito,
  esAmbito,
};
