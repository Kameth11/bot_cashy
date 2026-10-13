// Al arrancar: comprueba que cada tabla del registro (src/lib/tablas.js) exista en Supabase.
//
// Una migración sin correr (o una tabla mal registrada) hacía que una función entera quedara
// rota en silencio, y recién se notaba cuando un usuario veía que algo no llegaba. Acá se avisa en
// el deploy, con un `error` que dice qué migración falta.
//
// NO tumba el servidor: el resto de la app tiene que seguir andando aunque una tabla falte (los
// servicios con respaldo caen a memoria). Tampoco bloquea el arranque: se lanza sin esperar.

const { isAvailable, getSupabase } = require('./supabase');
const { TABLAS } = require('./tablas');
const { logFallo } = require('./errores');
const defaultLogger = require('./logger');

const FALTA_LA_TABLA = /does not exist|could not find|not found|schema cache/i;
const esTablaFaltante = (error) => Boolean(error) && (['42P01', 'PGRST205'].includes(String(error.code || '')) || FALTA_LA_TABLA.test(error.message || ''));

/**
 * @returns {Promise<{verificadas:number, faltantes:string[], opcionalesFaltantes:string[], conError:string[]}>}
 */
async function verificarTablas(logger = defaultLogger) {
  const resultado = { verificadas: 0, faltantes: [], opcionalesFaltantes: [], conError: [] };
  if (!isAvailable()) return resultado; // modo Sheets: no hay Supabase que verificar

  const supabase = getSupabase();
  const nombres = Object.keys(TABLAS).filter(t => TABLAS[t].ambito !== 'borrador');

  await Promise.all(nombres.map(async (tabla) => {
    try {
      // tenant-isolation-ignore: sonda de existencia de la tabla (head:true, limit 0): no lee datos de nadie.
      const { error } = await supabase.from(tabla).select('*', { head: true, count: 'exact' }).limit(0);
      if (!error) { resultado.verificadas += 1; return; }

      if (esTablaFaltante(error)) {
        if (TABLAS[tabla].opcional) {
          resultado.opcionalesFaltantes.push(tabla);
          logger.warn('TABLAS', `Falta la tabla opcional '${tabla}': esa función queda desactivada`, { tabla });
        } else {
          resultado.faltantes.push(tabla);
          logger.error('TABLAS', `Falta la tabla '${tabla}' en Supabase: correr su migración en sql/migrations/`, { tabla });
        }
        return;
      }
      resultado.conError.push(tabla);
      logFallo('TABLAS', `No se pudo verificar la tabla '${tabla}'`, error, { tabla });
    } catch (err) {
      resultado.conError.push(tabla);
      logFallo('TABLAS', `No se pudo verificar la tabla '${tabla}'`, err, { tabla });
    }
  }));

  const mal = resultado.faltantes.length + resultado.conError.length;
  if (mal === 0) logger.info('TABLAS', `Tablas verificadas: ${resultado.verificadas}`, { opcionalesFaltantes: resultado.opcionalesFaltantes.length });
  return resultado;
}

module.exports = { verificarTablas };
