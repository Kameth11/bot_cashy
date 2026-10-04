// Categorización y resolución de ámbito para finanzas personales.
//
// Este módulo es PURO (sin I/O): recibe el texto y, opcionalmente, el mapa de
// preferencias aprendidas, y devuelve categoría/ámbito. La persistencia de las
// preferencias vive en personal.service.js. Así se puede testear sin tocar
// Sheets ni Supabase.

const { normalizar, tieneContextoClinico } = require('./quick_nlp.service');
const { buscarProveedorEnTexto } = require('../utils/proveedores-servicios');

// ── Categorías cerradas del ámbito personal ──────────────────────────────────

const CATEGORIAS_EGRESO_PERSONAL = [
  'supermercado',
  'transporte',
  'auto',
  'alquiler',
  'servicios',
  'expensas',
  'salud',
  'farmacia',
  'educacion',
  'entretenimiento',
  'comida_afuera',
  'ropa',
  'tecnologia',
  'mascotas',
  'regalos',
  'viajes',
  'impuestos',
  'otros',
];

const CATEGORIAS_INGRESO_PERSONAL = [
  'sueldo',
  'alquiler_cobrado',
  'freelance',
  'otro_ingreso',
];

const ALL_CATEGORIAS_PERSONAL = new Set([
  ...CATEGORIAS_EGRESO_PERSONAL,
  ...CATEGORIAS_INGRESO_PERSONAL,
]);

// ── Diccionario de categorías (mismo shape que EGRESO_CATEGORY_PATTERNS) ─────
// El orden importa: se devuelve la primera que matchea.

const EGRESO_PERSONAL_PATTERNS = [
  { categoria: 'supermercado', pattern: /supermercado|super\b|coto|carrefour|jumbo|disco|vea|dia\b|makro|vital|mayorista|almacen|verduleria|carniceria|panaderia|fiambreria|dietetica/i },
  { categoria: 'transporte', pattern: /nafta|gasoil|gas\s*oil|combustible|ypf|shell|axion|puma\b|refinor|sube|peaje|uber|cabify|didi|taxi|remis|colectivo|subte|tren\b|estacionamiento|cochera/i },
  { categoria: 'auto', pattern: /patente|vtv|cubierta|neumatico|lavadero|mecanico|taller|service\s+del?\s+auto|seguro\s+del?\s+auto|grua/i },
  { categoria: 'comida_afuera', pattern: /resto\b|restaurante|delivery|pedidosya|pedidos\s*ya|rappi|mcdonald|burger|heladeria|heladi|cafeteria|bar\b|cerveceria|pizzeria|parrilla|sushi|almuerzo|cena\s+afuera|desayuno\s+afuera/i },
  { categoria: 'entretenimiento', pattern: /netflix|spotify|disney|hbo|max\b|prime\s*video|paramount|star\+|youtube\s*premium|streaming|cine|teatro|recital|concierto|boliche|salida|videojuego|playstation|xbox|steam|nintendo/i },
  { categoria: 'educacion', pattern: /colegio|escuela|universidad|facultad|matricula|cuota\s+del?\s+colegio|curso|capacitacion|posgrado|maestria|ingles|idioma|libro|utiles|guarderia|jardin/i },
  { categoria: 'mascotas', pattern: /veterinari|mascota|perro|gato|alimento\s+balanceado|balanceado|petshop|pet\s*shop|vacuna\s+del?\s+(?:perro|gato)/i },
  { categoria: 'ropa', pattern: /ropa|zapatilla|zapato|calzado|indumentaria|camisa|pantalon|vestido|campera|remera|zara|h&m|adidas|nike|shopping/i },
  { categoria: 'tecnologia', pattern: /celular|notebook|laptop|computadora|monitor|teclado|mouse|auricular|tablet|iphone|samsung|cargador|disco\s+externo|mercado\s*libre/i },
  { categoria: 'regalos', pattern: /regalo|cumpleanos|cumple\b|aguinaldo\s+a|navidad|reyes|casamiento|baby\s*shower/i },
  { categoria: 'viajes', pattern: /pasaje|vuelo|aereo|hotel|hostel|airbnb|alojamiento|excursion|turismo|agencia\s+de\s+viaje|despegar|booking|valija/i },
  { categoria: 'salud', pattern: /prepaga|osde|swiss\s*medical|galeno|medicus|obra\s+social|kinesiolog|psicolog|nutricionist|oculista|dentista|analisis|estudio\s+medico|gimnasio|gym\b/i },
];

const INGRESO_PERSONAL_PATTERNS = [
  { categoria: 'sueldo', pattern: /sueldo|salario|aguinaldo|quincena|jornal/i },
  { categoria: 'alquiler_cobrado', pattern: /alquiler\s+(?:cobrado|del?\s+(?:depto|departamento|casa|local|inquilino))|renta|inquilino/i },
  { categoria: 'freelance', pattern: /freelance|honorario\s+propio|laburo\s+extra|trabajo\s+extra|changa|proyecto\s+aparte/i },
];

// ── Calificadores explícitos (Capa 1) ────────────────────────────────────────
// Ganan sobre cualquier otra señal: son una declaración del usuario.

const CALIFICADOR_PERSONAL = /\b(?:de\s+(?:mi\s+)?casa|en\s+(?:mi\s+)?casa|del\s+depto|del\s+departamento|de\s+mi\s+depto|domicilio|hogar|personal(?:es)?|particular|mio|mia|propio|familiar)\b/i;
// Con una CASA compartida de por medio, "de casa", "hogar" o "familiar" ya no
// significan personal sino la casa; lo personal se declara con estas palabras.
const CALIFICADOR_PERSONAL_FUERTE = /\b(?:personal(?:es)?|particular|mio|mia|propio)\b/i;
// (Se prueban sobre el texto sin tildes.) "casa" suelta cuenta: con casas, nombrarla es nombrar la activa.
const CALIFICADOR_CASA_GENERICO = /\b(?:casa|hogar|familiar|compartid[oa]s?|entre\s+todos)\b/i;

const CALIFICADOR_CONSULTORIO = /\b(?:del?\s+consultorio|en\s+el\s+consultorio|de\s+la\s+clinica|del?\s+laboratorio|del?\s+local|de\s+la\s+oficina|laboral|del?\s+trabajo)\b/i;

// ── Términos que ambos ámbitos reclaman (Capa 2/3) ───────────────────────────
// Estos son los que hoy caen en las categorías del consultorio
// (EGRESO_CATEGORY_PATTERNS en quick_nlp.service.js) pero que igual de bien
// pueden ser de la casa. Son los que necesitan preferencia o corrección.

const TERMINOS_AMBIGUOS = [
  'alquiler',
  'expensas',
  'luz',
  'agua',
  'gas',
  'internet',
  'telefono',
  'celular',
  'cable',
  'servicio',
  'impuesto',
  'monotributo',
  'arba',
  'afip',
  'abl',
  'rentas',
  'seguro',
  'farmacia',
  'medicamento',
  'sueldo',
  'limpieza',
  'plomero',
  'gasista',
  'electricista',
  'pintor',
  'mantenimiento',
  'reparacion',
  'software',
  'suscripcion',
];

// Marcadores fuertes de personal: si aparecen, no hay ambigüedad posible.
//
// Se derivan de los diccionarios de arriba, pero descartando las alternativas
// que SON exactamente un término ambiguo. Sin esto, "sueldo asistente 200k"
// (hoy un egreso del consultorio) pasaría a leerse como sueldo personal — una
// regresión. La comparación es por alternativa completa, no por substring, así
// que "seguro del auto" sobrevive aunque "seguro" suelto sea ambiguo.
const AMBIGUOS_SET = new Set(TERMINOS_AMBIGUOS);

// Posesivo + término ambiguo ("mi sueldo", "mis expensas", "mi alquiler") es una
// marca de propiedad personal. Se limita a los términos ambiguos a propósito:
// un "mi" suelto arrastraría cosas como "mi paciente" al ámbito equivocado.
const POSESIVO_PERSONAL = new RegExp(
  `\\b(?:mi|mis)\\s+(?:${TERMINOS_AMBIGUOS.join('|')})\\b`,
  'i'
);

function alternativasFuertes(pattern) {
  return pattern.source
    .split('|')
    .filter(alt => !AMBIGUOS_SET.has(alt.replace(/\\b/g, '').trim()));
}

const MARCADOR_PERSONAL_FUERTE = new RegExp(
  [...EGRESO_PERSONAL_PATTERNS, ...INGRESO_PERSONAL_PATTERNS]
    .flatMap(rule => alternativasFuertes(rule.pattern))
    .join('|'),
  'i'
);

// ── API ───────────────────────────────────────────────────────────────────────

function normalizarCategoriaPersonal(categoria) {
  if (categoria == null) return null;
  const text = String(categoria)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');

  return ALL_CATEGORIAS_PERSONAL.has(text) ? text : null;
}

function esEgreso(tipo) {
  return ['gasto', 'egreso'].includes(String(tipo || '').toLowerCase());
}

// Devuelve la categoría personal inferida del texto, o la de fallback.
function inferirCategoriaPersonal(tipo, texto = '') {
  const source = normalizar(String(texto || ''));
  const patterns = esEgreso(tipo) ? EGRESO_PERSONAL_PATTERNS : INGRESO_PERSONAL_PATTERNS;

  for (const rule of patterns) {
    if (rule.pattern.test(source)) return rule.categoria;
  }

  // Los ambiguos ya resueltos como personales tienen su propia categoría
  if (esEgreso(tipo)) {
    if (/alquiler/.test(source)) return 'alquiler';
    if (/expensa/.test(source)) return 'expensas';
    if (/luz|agua|gas\b|internet|telefono|celular|cable|wifi|fibra/.test(source) || buscarProveedorEnTexto(texto)) return 'servicios';
    if (/impuesto|monotributo|arba|afip|abl|rentas|patente/.test(source)) return 'impuestos';
    if (/farmacia|medicamento|remedio/.test(source)) return 'farmacia';
    return 'otros';
  }

  return 'otro_ingreso';
}

// Extrae el término ambiguo presente en el texto, si hay alguno.
// Se usa como clave de la memoria de preferencias.
// Las empresas de servicios (Naturgy, Edenor, Movistar...) cuentan como
// ambiguas: la misma boleta puede ser del consultorio o de la casa, así que se
// arranca en consultorio avisando y se recuerda la corrección por empresa.
function detectarTerminoAmbiguo(texto = '') {
  const source = normalizar(String(texto || ''));
  const termino = TERMINOS_AMBIGUOS.find(t => new RegExp(`\\b${t}`, 'i').test(source));
  if (termino) return termino;
  const proveedor = buscarProveedorEnTexto(texto);
  return proveedor && proveedor.grupo !== 'combustible' ? proveedor.nombre : null;
}

// ¿El texto nombra a alguna de las casas del usuario? Se acepta el nombre completo
// ("casa dinamarca") o su parte distintiva sin el "casa" ("dinamarca"). Gana el
// nombre más largo, así "casa dinamarca" no se confunde con una casa llamada "Casa".
function casaMencionada(texto, casas) {
  const t = normalizar(texto);
  const escapar = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const candidatos = [];
  for (const c of casas) {
    const nombre = normalizar(c.nombre);
    // Un nombre genérico ("Casa", "Hogar") no identifica a una casa en particular:
    // lo resuelve el calificador genérico hacia la casa activa.
    if (nombre && !/^(?:casa|hogar|depto|departamento)$/.test(nombre)) candidatos.push({ c, clave: nombre });
    const distintivo = nombre.replace(/^(?:casa|hogar|depto|departamento)\s+/, '');
    if (distintivo !== nombre && distintivo.length >= 3) candidatos.push({ c, clave: distintivo });
  }
  candidatos.sort((a, b) => b.clave.length - a.clave.length);
  const hit = candidatos.find(({ clave }) => new RegExp(`\\b${escapar(clave)}\\b`).test(t));
  return hit ? hit.c : null;
}

/**
 * Resuelve si un movimiento es del ámbito personal o del consultorio.
 *
 * Tres capas, en orden de prioridad:
 *   1. Calificador explícito en el texto ("luz de casa" / "luz del consultorio")
 *   2. Preferencia aprendida para el término ambiguo (el usuario ya lo corrigió)
 *   3. Fallback a 'consultorio' — preserva el comportamiento histórico del bot
 *
 * @param {string} rawText texto original del usuario
 * @param {object} opts
 * @param {object|Map} opts.preferencias mapa termino -> ambito
 * @param {Array<{casaId,nombre,activa?}>} opts.casas casas compartidas del usuario (opcional)
 * @returns {{ambito: 'personal'|'consultorio'|'casa', casaId?: string, casaNombre?: string, ambiguo: boolean, termino: string|null, razon: string}}
 */
function resolverAmbito(rawText, opts = {}) {
  const texto = String(rawText || '');
  const preferencias = opts.preferencias || {};
  const termino = detectarTerminoAmbiguo(texto);

  const leerPreferencia = (key) => {
    if (!key) return null;
    if (typeof preferencias.get === 'function') return preferencias.get(key) || null;
    return preferencias[key] || null;
  };

  // Casas compartidas del usuario (vacío = comportamiento histórico, sin cambios).
  const casas = Array.isArray(opts.casas) ? opts.casas.filter((c) => c && c.casaId) : [];
  const enCasa = (c, razon) => ({ ambito: 'casa', casaId: c.casaId, casaNombre: c.nombre, ambiguo: false, termino, razon });
  const casaActiva = casas.find((c) => c.casaId === opts.casaActivaId) || casas.find((c) => c.activa) || casas[0];

  // Capa 1 — calificador explícito. Gana sobre todo.
  if (CALIFICADOR_CONSULTORIO.test(texto)) {
    return { ambito: 'consultorio', ambiguo: false, termino, razon: 'calificador' };
  }
  if (casas.length > 0) {
    const mencionada = casaMencionada(texto, casas);
    if (mencionada) return enCasa(mencionada, 'calificador_casa');
    const sinTildes = normalizar(texto);
    if (CALIFICADOR_PERSONAL_FUERTE.test(sinTildes) || POSESIVO_PERSONAL.test(sinTildes)) {
      return { ambito: 'personal', ambiguo: false, termino, razon: 'calificador' };
    }
    if (CALIFICADOR_CASA_GENERICO.test(sinTildes)) return enCasa(casaActiva, 'calificador_casa');
  } else if (CALIFICADOR_PERSONAL.test(texto) || POSESIVO_PERSONAL.test(normalizar(texto))) {
    return { ambito: 'personal', ambiguo: false, termino, razon: 'calificador' };
  }

  // Marcadores fuertes de consultorio (tratamientos, insumos, pacientes).
  if (tieneContextoClinico(texto)) {
    return { ambito: 'consultorio', ambiguo: false, termino: null, razon: 'marcador_clinico' };
  }

  // Marcadores fuertes de personal (comercios, nafta, streaming...). Ganan
  // incluso si además hay un término ambiguo: en "seguro del auto" o
  // "farmacia del super" el marcador desambigua por sí solo.
  if (MARCADOR_PERSONAL_FUERTE.test(normalizar(texto))) {
    return { ambito: 'personal', ambiguo: false, termino, razon: 'marcador_personal' };
  }

  // Capa 2 — memoria: el usuario ya corrigió este término antes.
  const preferido = leerPreferencia(termino);
  if (preferido === 'personal' || preferido === 'consultorio') {
    return { ambito: preferido, ambiguo: false, termino, razon: 'preferencia' };
  }
  // "casa:<id>": solo vale si el usuario sigue perteneciendo a esa casa.
  if (typeof preferido === 'string' && preferido.startsWith('casa:')) {
    const c = casas.find((x) => x.casaId.toLowerCase() === preferido.slice(5));
    if (c) return enCasa(c, 'preferencia');
  }

  // Capa 3 — fallback: consultorio, igual que hoy, pero marcado como ambiguo
  // para que la confirmación resalte el botón de corrección.
  return {
    ambito: 'consultorio',
    ambiguo: Boolean(termino),
    termino,
    razon: termino ? 'fallback_ambiguo' : 'fallback',
  };
}

module.exports = {
  resolverAmbito,
  inferirCategoriaPersonal,
  normalizarCategoriaPersonal,
  detectarTerminoAmbiguo,
  CATEGORIAS_EGRESO_PERSONAL,
  CATEGORIAS_INGRESO_PERSONAL,
  ALL_CATEGORIAS_PERSONAL,
  TERMINOS_AMBIGUOS,
  EGRESO_PERSONAL_PATTERNS,
  INGRESO_PERSONAL_PATTERNS,
};
