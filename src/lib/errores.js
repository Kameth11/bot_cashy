// Clasifica un fallo para decidir con qué severidad loguearlo.
//
// Los servicios con respaldo (notificaciones, chat, etc.) atrapan los errores de Supabase y
// siguen en memoria para no romper la acción del usuario. Eso está bien para una caída pasajera,
// pero esconde los errores nuestros: una tabla sin registrar o un TypeError se veían como un
// `warn` más y la función quedaba rota sin que nadie se enterara. Regla:
//
//   - error de PROGRAMACIÓN o de CONFIGURACIÓN (código mal armado, tabla sin registrar, esquema o
//     permisos de la base mal)  → logger.error: hay que arreglarlo, y es lo que debe alertar.
//   - fallo TRANSITORIO (red, timeout, base ocupada)               → logger.warn: se reintenta solo.
//
// El respaldo sigue funcionando igual en los dos casos; lo único que cambia es qué tan visible es.

const logger = require('./logger');

const TIPOS_DE_PROGRAMACION = [TypeError, ReferenceError, RangeError, SyntaxError];

// Mensajes de las guardas de tenant-db.js / persona-db.js: solo se disparan por código mal armado.
const GUARDAS_DE_AISLAMIENTO = /no esta en SCOPED_TABLES|no es una tabla personal|llamado sin (userId|tenantId)|con userId inválido/i;

// Códigos de Postgres/PostgREST que indican esquema o permisos mal, no un fallo pasajero:
// 42501 permiso denegado/RLS, 42703 columna inexistente, 42883 función inexistente,
// 42P01 tabla inexistente, PGRST200/202/204/205 relación, función, columna o tabla fuera del esquema.
const CODIGOS_DE_CONFIGURACION = new Set(['42501', '42703', '42883', '42P01', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205']);

// Excepción lanzada por NUESTRO código (no un error de red).
function esErrorDeProgramacion(err) {
  if (!(err instanceof Error)) return false;
  return TIPOS_DE_PROGRAMACION.some(Tipo => err instanceof Tipo) || GUARDAS_DE_AISLAMIENTO.test(err.message || '');
}

// Objeto `error` que devuelve supabase-js ({ message, code }).
function esErrorDeConfiguracionSupabase(error) {
  return Boolean(error && CODIGOS_DE_CONFIGURACION.has(String(error.code || '')));
}

// Es un error que hay que ARREGLAR (no reintentar): Error lanzado o respuesta de Supabase.
function esErrorAccionable(err) {
  return esErrorDeProgramacion(err) || esErrorDeConfiguracionSupabase(err);
}

// Loguea con la severidad que corresponde. Devuelve true si fue `error`.
function logFallo(scope, mensaje, err, extra = {}) {
  const accionable = esErrorAccionable(err);
  const meta = { ...extra, err: (err && err.message) || String(err), ...(err && err.code ? { codigo: err.code } : {}) };
  (accionable ? logger.error : logger.warn)(scope, mensaje, meta);
  return accionable;
}

module.exports = { esErrorDeProgramacion, esErrorDeConfiguracionSupabase, esErrorAccionable, logFallo };
