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

// ── Búsqueda en texto libre ("naturgy 25000") ────────────────────────────────
// Un texto escrito a mano es más ambiguo que el emisor de un comprobante: "gasto
// personal 5000" no es la telefonía Personal, ni "claro que sí" es Claro. Se
// excluyen los nombres que son palabras comunes o siglas demasiado cortas.
const AMBIGUOS_EN_TEXTO = new Set(['personal', 'claro', 'flow', 'puma', 'gulf', 'epe', 'edea', 'ersa', 'amx', 'telecom', 'speedy']);
const NOMBRES_EN_TEXTO = [];
for (const [grupo, nombres] of Object.entries(PROVEEDORES)) {
  for (const n of nombres) {
    const clave = quitarTildes(n);
    if (!AMBIGUOS_EN_TEXTO.has(clave)) NOMBRES_EN_TEXTO.push({ clave, grupo });
  }
}
// Más largos primero: "litoral gas" gana sobre "gas".
NOMBRES_EN_TEXTO.sort((a, b) => b.clave.length - a.clave.length);
const REGEX_EN_TEXTO = new RegExp(`\\b(?:${NOMBRES_EN_TEXTO.map((n) => escapar(n.clave)).join('|')})\\b`);

// Fuente (sin banderas) para componer regex en otros módulos.
const PATRON_EN_TEXTO = REGEX_EN_TEXTO.source;

/**
 * ¿El texto nombra a una empresa de servicios conocida?
 * @returns {{ nombre: string, grupo: string } | null} nombre normalizado (sin tildes, minúsculas)
 */
function buscarProveedorEnTexto(texto) {
  const t = quitarTildes(texto);
  const m = REGEX_EN_TEXTO.exec(t);
  if (!m) return null;
  const hit = NOMBRES_EN_TEXTO.find((n) => n.clave === m[0]);
  return hit ? { nombre: hit.clave, grupo: hit.grupo } : null;
}

function esProveedorDeServicios({ emisor, rubro } = {}) {
  if (emisor && REGEX_EMISOR.test(quitarTildes(emisor))) return true;
  return Boolean(rubro && REGEX_RUBRO.test(quitarTildes(rubro)));
}

// Ejemplos para los prompts (mismos nombres que usa el catálogo).
function ejemplosParaPrompt() {
  return TODOS.join(', ');
}

module.exports = { PROVEEDORES, esProveedorDeServicios, buscarProveedorEnTexto, PATRON_EN_TEXTO, ejemplosParaPrompt };
