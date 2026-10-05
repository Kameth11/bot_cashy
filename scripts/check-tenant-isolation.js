// Falla si aparece una consulta a Supabase sin clasificar o fuera de tenant-db.js.
// Es la red de seguridad de la Fase 2 de multi-tenancy (ver ARCHITECTURE.md
// seccion 3): toda query a tablas de negocio debe pasar por
// src/lib/tenant-db.js para no filtrar datos entre tenants.
//
// Este script solo hace analisis estatico de texto, no toca Supabase real,
// pero igual arrastra src/config/index.js (via tenant-db -> supabase) que
// hace process.exit(1) si faltan las env vars de la app. En CI no hay .env,
// asi que sin esto el script muere antes de poder analizar nada. Reusa los
// valores dummy que ya usan los tests (no pisa env vars reales si existen).
require('../tests/setup-env');

const fs = require('fs');
const path = require('path');
const { SCOPED_TABLES } = require('../src/lib/tenant-db');

const SRC_DIR = path.join(__dirname, '..', 'src');
const ALLOWED_FILES = new Set([
  path.join(SRC_DIR, 'lib', 'tenant-db.js'),
  path.join(SRC_DIR, 'lib', 'persona-db.js'),
  path.join(SRC_DIR, 'lib', 'supabase.js'),
  path.join(SRC_DIR, 'services', 'tenant.service.js'),
]);

// Modelo "lista cerrada": TODA tabla que se consulte con .from(...) tiene que
// estar clasificada acá o en SCOPED_TABLES (tenant-db.js). Antes el script solo
// miraba las tablas de SCOPED_TABLES, así que una tabla nueva de negocio (o las
// de v2) quedaba fuera del control sin que nada avisara.
//
//  - SCOPED_TABLES: datos de negocio por tenant → solo vía forTenant().
//  - GLOBAL_TABLES: mapeo identidad/tenant o infraestructura, deliberadamente
//    sin tenant_id (ver comentarios en tenant-db.js y tenant.service.js).
//  - DRAFT_TABLES: esquemas draft que no existen en producción todavía. Al
//    activarlas hay que sumarles tenant_id y pasarlas a SCOPED_TABLES.
const GLOBAL_TABLES = new Set(['profiles', 'tenants', 'tenant_requests', 'auth_codes']);
const DRAFT_TABLES = new Set(['movimientos_v2', 'movimiento_eventos_v2']);

// Las tablas del ámbito PERSONAL son de cada persona (no del consultorio): además de
// forTenant() tienen que filtrar por user_id, y eso solo lo garantiza forPersona()
// (src/lib/persona-db.js). personal.service.js usa forTenant() directo SOLO para el
// espejo del modo PERSONAL_STORE=sheets (que filtra por user_id a mano) y es el único
// archivo con esa excepción.
const PERSONA_TABLES = new Set([
  'movimientos_personales',
  'viajes_personales',
  'presupuestos_personales',
  'preferencias_ambito_personales',
]);
const PERSONA_LEGACY_FILES = new Set([path.join(SRC_DIR, 'services', 'personal.service.js')]);

const FROM_LITERAL = /\.from\(\s*['"`]([a-z_0-9]+)['"`]\s*\)/g;
const FROM_ANY = /\.from\(/;
const NO_SUPABASE_FROM = /(Buffer|Array|Object|Uint8Array)\.from\(/;
const RPC = /\.rpc\(/;

function listJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith('.js')) return [fullPath];
    return [];
  });
}

// Analiza el contenido de un archivo y devuelve la lista de problemas. Pura
// (sin I/O) para poder testearla.
function analizarContenido(content, { scoped = SCOPED_TABLES, personaLegacy = false } = {}) {
  const problemas = [];
  const lines = content.split('\n');
  const importaPersona = /require\([^)]*persona-db[^)]*\)/.test(content);
  const usaForTenant = /forTenant\(/.test(content);

  lines.forEach((line, idx) => {
    if (RPC.test(line)) {
      const ventana = lines.slice(Math.max(0, idx - 4), idx + 1).join('\n');
      if (!ventana.includes('tenant-isolation-ignore')) {
        problemas.push({ linea: idx + 1, texto: line.trim(), motivo: '.rpc() no está cubierto por el aislamiento de tenant' });
      }
    }

    if (!FROM_ANY.test(line) || NO_SUPABASE_FROM.test(line)) return;

    // El .from(tabla) suele venir varias líneas después de donde se obtuvo el
    // cliente (forTenant(tenantId)\n  .from(...) o un comentario de
    // excepción): se mira una ventana de líneas previas.
    const ventana = lines.slice(Math.max(0, idx - 4), idx + 1).join('\n');
    const ignorada = ventana.includes('tenant-isolation-ignore');

    const literales = [...line.matchAll(FROM_LITERAL)].map(m => m[1]);
    if (literales.length === 0) {
      if (!ignorada) problemas.push({ linea: idx + 1, texto: line.trim(), motivo: '.from() con tabla dinámica: no se puede verificar (marcar con tenant-isolation-ignore si es una sonda)' });
      return;
    }

    for (const tabla of literales) {
      if (PERSONA_TABLES.has(tabla) && !personaLegacy && !ignorada) {
        // Válido: forPersona( en la ventana, o un archivo que importa persona-db y
        // NO usa forTenant (el cliente sale de una variable, p.from(...)). Mezclar
        // forTenant y tablas personales en un mismo archivo sigue prohibido.
        const viaPersona = ventana.includes('forPersona(') || (importaPersona && !usaForTenant);
        if (!viaPersona) {
          problemas.push({ linea: idx + 1, texto: line.trim(), motivo: `'${tabla}' es personal: usar forPersona(tenantId, userId).from() (filtra por persona)` });
        }
        continue;
      }
      if (scoped.has(tabla)) {
        if (!ventana.includes('forTenant(') && !ignorada) {
          problemas.push({ linea: idx + 1, texto: line.trim(), motivo: `'${tabla}' es de negocio: usar forTenant(tenantId).from()` });
        }
      } else if (GLOBAL_TABLES.has(tabla) || DRAFT_TABLES.has(tabla)) {
        continue;
      } else if (!ignorada) {
        problemas.push({ linea: idx + 1, texto: line.trim(), motivo: `tabla '${tabla}' sin clasificar: agregarla a SCOPED_TABLES (tenant-db.js) o a GLOBAL_TABLES (este script)` });
      }
    }
  });

  return problemas;
}

function main() {
  const offenders = [];

  for (const file of listJsFiles(SRC_DIR)) {
    if (ALLOWED_FILES.has(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const p of analizarContenido(content, { personaLegacy: PERSONA_LEGACY_FILES.has(file) })) {
      offenders.push(`${path.relative(process.cwd(), file)}:${p.linea}: ${p.texto}\n      -> ${p.motivo}`);
    }
  }

  if (offenders.length > 0) {
    console.error('Riesgo de fuga cross-tenant: consultas a Supabase sin clasificar o fuera de tenant-db.js:\n');
    offenders.forEach(o => console.error(`  ${o}`));
    process.exit(1);
  }

  console.log('check-tenant-isolation: OK, todas las tablas consultadas están clasificadas y las de negocio pasan por tenant-db.js');
}

if (require.main === module) main();

module.exports = { analizarContenido, GLOBAL_TABLES, DRAFT_TABLES, PERSONA_TABLES };
