// Falla si aparece getSupabase().from(...) fuera de los archivos permitidos.
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
  path.join(SRC_DIR, 'lib', 'supabase.js'),
  path.join(SRC_DIR, 'services', 'tenant.service.js'),
]);

// Detecta .from('movimientos')/.from("movimientos")/etc para cualquier
// tabla de SCOPED_TABLES, sin importar como se obtuvo el cliente (no
// depende de que el llamado a getSupabase() este en la misma linea).
const FROM_PATTERN = new RegExp(
  `\\.from\\(\\s*['"\`](${[...SCOPED_TABLES].join('|')})['"\`]\\s*\\)`
);

function listJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith('.js')) return [fullPath];
    return [];
  });
}

function main() {
  const offenders = [];

  for (const file of listJsFiles(SRC_DIR)) {
    if (ALLOWED_FILES.has(file)) continue;

    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (!FROM_PATTERN.test(line)) return;

      // El .from(tabla) suele venir varias lineas despues de donde se
      // obtuvo el cliente (forTenant(tenantId)\n  .from(...) o un
      // comentario de excepcion). Se mira una ventana de lineas previas
      // en vez de solo la linea anterior.
      const ventana = lines.slice(Math.max(0, idx - 4), idx + 1).join('\n');
      if (ventana.includes('forTenant(') || ventana.includes('tenant-isolation-ignore')) return;

      offenders.push(`${path.relative(process.cwd(), file)}:${idx + 1}: ${line.trim()}`);
    });
  }

  if (offenders.length > 0) {
    console.error('Query a Supabase fuera de tenant-db.js encontrada (riesgo de fuga cross-tenant):\n');
    offenders.forEach(o => console.error(`  ${o}`));
    console.error('\nUsa forTenant(tenantId).from(tabla) de src/lib/tenant-db.js en su lugar.');
    process.exit(1);
  }

  console.log('check-tenant-isolation: OK, no hay queries de negocio fuera de tenant-db.js');
}

main();
