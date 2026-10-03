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

module.exports = {
  AMBITO_CONSULTORIO,
  AMBITO_PERSONAL,
  AMBITO_CASA,
  AMBITOS,
  normalizarAmbito,
  esAmbito,
};
