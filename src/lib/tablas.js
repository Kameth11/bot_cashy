// Registro ÚNICO de las tablas de Supabase y de cómo se accede a cada una.
//
// Antes esto vivía repartido en tres listas (SCOPED_TABLES en tenant-db.js, PERSONA_TABLES en
// persona-db.js y otra copia más en scripts/check-tenant-isolation.js). Faltar en una sola rompía
// en silencio la función entera: así dejaron de andar la campanita y el push. Ahora hay UN lugar, y
// las demás listas se derivan de acá.
//
// Para agregar una tabla: sumarla acá con su `ambito` (y la migración en sql/migrations/).
//
//   ambito 'negocio'  → datos del consultorio. Solo vía forTenant() (filtra por tenant_id).
//   ambito 'persona'  → datos de UNA persona dentro del consultorio. Solo vía forPersona()
//                       (filtra por tenant_id y por user_id).
//   ambito 'global'   → mapeo de identidad o infraestructura, deliberadamente sin tenant_id
//                       (ver tenant-db.js y tenant.service.js). Se consulta con getSupabase().
//   ambito 'borrador' → esquema draft que NO existe en producción (no se verifica al arrancar).
//
//   opcional: true    → el código funciona sin la tabla (la sondea antes de usarla).

const TABLAS = {
  // ── Negocio (por consultorio) ──
  movimientos:       { ambito: 'negocio' },
  profesionales:     { ambito: 'negocio' },
  // sql/migrations/011. El código sondea si existe antes de usarla (comprobante-archivo.service.js).
  comprobantes:      { ambito: 'negocio', opcional: true },

  // ── Personales (de cada persona) ──
  movimientos_personales:         { ambito: 'persona' }, // 008
  viajes_personales:              { ambito: 'persona' }, // 008
  presupuestos_personales:        { ambito: 'persona' }, // 008
  preferencias_ambito_personales: { ambito: 'persona' }, // 013: memoria de correcciones de ámbito
  chat_historial:                 { ambito: 'persona' }, // 015: historial del chat web
  notificaciones:                 { ambito: 'persona' }, // 020: campanita
  push_subscriptions:             { ambito: 'persona' }, // 020: Web Push

  // ── Globales ──
  profiles:          { ambito: 'global' }, // userId -> tenantId: se consulta sin tenant resuelto
  tenants:           { ambito: 'global' },
  tenant_requests:   { ambito: 'global' },
  auth_codes:        { ambito: 'global' },
  // Se busca por EMAIL al entrar con Google (todavía no se sabe de qué consultorio es); por eso es
  // global, con tenant_id explícito: invitacion-web.service.js filtra por él en todo lo que lista, crea o revoca.
  invitaciones_web:  { ambito: 'global' },

  // ── Borradores (no existen en producción; al activarlas sumarles tenant_id y pasarlas a 'negocio') ──
  movimientos_v2:           { ambito: 'borrador' },
  movimiento_eventos_v2:    { ambito: 'borrador' },
};

// Tablas que crean las migraciones pero que son infraestructura y no se consultan desde src/.
const TABLAS_DE_INFRAESTRUCTURA = new Set(['schema_migrations']);

const AMBITOS = ['negocio', 'persona', 'global', 'borrador'];

const deAmbito = (...ambitos) => new Set(Object.keys(TABLAS).filter(t => ambitos.includes(TABLAS[t].ambito)));

module.exports = {
  TABLAS,
  AMBITOS,
  TABLAS_DE_INFRAESTRUCTURA,
  // forTenant() acepta las de negocio y las personales (forPersona se apoya en él).
  SCOPED_TABLES: deAmbito('negocio', 'persona'),
  PERSONA_TABLES: deAmbito('persona'),
  GLOBAL_TABLES: deAmbito('global'),
  DRAFT_TABLES: deAmbito('borrador'),
};
