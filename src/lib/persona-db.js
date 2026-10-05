// Acceso a las tablas del ámbito PERSONAL, siempre acotado a UNA persona.
//
// forTenant() aísla por tenant (consultorio), pero dentro de un tenant conviven
// el dueño, los odontólogos, la secretaria... y lo personal es de cada uno. Hasta
// ahora separar personas dependía de acordarse de poner `.eq('user_id', ...)` en
// cada consulta; con Personal abierto a todos, un solo olvido filtra datos de otra
// persona. Este wrapper lo hace imposible de olvidar:
//
//   - select / update / delete: siempre agrega `.eq('user_id', <persona>)`.
//   - insert / upsert: SIEMPRE fuerza `user_id` a esa persona (ignora el que venga).
//   - update: descarta `user_id` y `tenant_id` del payload (no se puede "mover" una
//     fila a otra persona).
//
// scripts/check-tenant-isolation.js exige que las tablas personales solo se
// consulten con forPersona(). Ver ARCHITECTURE.md sección 4.

const { forTenant } = require('./tenant-db');

const PERSONA_TABLES = new Set([
  'movimientos_personales',
  'viajes_personales',
  'presupuestos_personales',
  'preferencias_ambito_personales',
]);

function sinIdentidad(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const { user_id: _u, tenant_id: _t, ...resto } = payload; // eslint-disable-line no-unused-vars
  return resto;
}

function forPersona(tenantId, userId) {
  if (userId === undefined || userId === null || userId === '') {
    throw new Error('forPersona() llamado sin userId: query sin aislamiento por persona bloqueada');
  }
  const uid = Number(userId);
  if (!Number.isFinite(uid)) {
    throw new Error(`forPersona() con userId inválido: ${String(userId).slice(0, 20)}`);
  }

  const base = forTenant(tenantId); // lanza si falta tenantId; null si no hay Supabase
  if (!base) return null;

  return {
    from(table) {
      if (!PERSONA_TABLES.has(table)) {
        throw new Error(`Tabla '${table}' no es una tabla personal: usar forTenant() (tenant-db.js) o agregarla a PERSONA_TABLES (persona-db.js)`);
      }

      const builder = base.from(table); // ya acotado por tenant
      const select = builder.select.bind(builder);
      const update = builder.update.bind(builder);
      const del = builder.delete.bind(builder);
      const insert = builder.insert.bind(builder);
      const upsert = builder.upsert.bind(builder);

      const conPersona = (rows) => (Array.isArray(rows)
        ? rows.map(r => ({ ...r, user_id: uid }))
        : { ...rows, user_id: uid });

      builder.select = (...args) => select(...args).eq('user_id', uid);
      builder.update = (patch, ...resto) => update(sinIdentidad(patch), ...resto).eq('user_id', uid);
      builder.delete = (...args) => del(...args).eq('user_id', uid);
      builder.insert = (rows, ...resto) => insert(conPersona(rows), ...resto);
      builder.upsert = (rows, opts) => upsert(conPersona(rows), opts);

      return builder;
    },
  };
}

module.exports = { forPersona, PERSONA_TABLES };
