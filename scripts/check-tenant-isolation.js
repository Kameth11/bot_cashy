// Falla si aparece getSupabase().from(...) fuera de los archivos permitidos.
// Es la red de seguridad de la Fase 2 de multi-tenancy (ver ARCHITECTURE.md
// seccion 3): toda query a tablas de negocio debe pasar por
// src/lib/tenant-db.js para no filtrar datos entre tenants.
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
      if (FROM_PATTERN.test(line)) {
        offenders.push(`${path.relative(process.cwd(), file)}:${idx + 1}: ${line.trim()}`);
      }
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
