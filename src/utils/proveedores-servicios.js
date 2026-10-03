// Catálogo de empresas de servicios de Argentina (luz, gas, agua, telefonía,
// internet, TV, combustible). Sirve para dos cosas:
// - listar ejemplos en los prompts de lectura de comprobantes;
// - categorizar como "servicios" aunque el modelo se equivoque: el nombre del
//   emisor es una señal más confiable que su interpretación del rubro.
//
// Los nombres se comparan sin tildes ni mayúsculas, con límite de palabra, y
// SOLO contra el emisor (nombres como "Personal" o "Claro" serían ambiguos en
// un texto libre).

const PROVEEDORES = {
  electricidad: [
    'Edenor', 'Edesur', 'Edelap', 'Edea', 'EPEC', 'EPE', 'Edemsa', 'EDET', 'Edesa',
    'Cooperativa Eléctrica', 'Energía de Entre Ríos', 'Edersa', 'Cammesa', 'Secheep', 'Ersa',
  ],
  gas: [
    'Naturgy', 'Metrogas', 'Camuzzi', 'Litoral Gas', 'Gasnor', 'Ecogas', 'Redengas', 'Gas Natural BAN', 'Gasnea',
  ],
  agua: [
    'AySA', 'ABSA', 'Aguas Cordobesas', 'Aguas Santafesinas', 'Aguas Bonaerenses', 'Aguas Mendocinas', 'Obras Sanitarias', 'Aguas del Norte',
  ],
  telefonia_internet_tv: [
    'Movistar', 'Telefónica', 'Personal', 'Telecom', 'Claro', 'AMX', 'Tuenti', 'Nextel', 'Telecentro',
    'Fibertel', 'Cablevisión', 'Flow', 'IPLAN', 'Speedy', 'Arnet', 'DirecTV', 'Telered', 'Netizen', 'Gigared',
  ],
  combustible: [
    'YPF', 'Shell', 'Axion', 'Puma', 'Gulf', 'Petrobras', 'Refinor', 'Dapsa', 'Voy con Energía', 'Sol Petróleo',
  ],
};

const quitarTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TODOS = Object.values(PROVEEDORES).flat();
const REGEX_EMISOR = new RegExp(`\\b(?:${TODOS.map((n) => escapar(quitarTildes(n))).join('|')})\\b`);

// Rubros genéricos que declara el modelo ("electricidad", "telefonía", ...).
const REGEX_RUBRO = /\b(?:electricidad|energia electrica|gas natural|agua potable|saneamiento|telefonia|telefono|internet|cable|television|combustible|nafta|gasoil|estacion de servicio)\b/;

function esProveedorDeServicios({ emisor, rubro } = {}) {
  if (emisor && REGEX_EMISOR.test(quitarTildes(emisor))) return true;
  return Boolean(rubro && REGEX_RUBRO.test(quitarTildes(rubro)));
}

// Ejemplos para los prompts (mismos nombres que usa el catálogo).
function ejemplosParaPrompt() {
  return TODOS.join(', ');
}

module.exports = { PROVEEDORES, esProveedorDeServicios, ejemplosParaPrompt };
