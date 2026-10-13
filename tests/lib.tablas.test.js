// Consistencia del registro único de tablas (src/lib/tablas.js) con el resto del sistema.

const fs = require('fs');
const path = require('path');
const { TABLAS, AMBITOS, TABLAS_DE_INFRAESTRUCTURA, SCOPED_TABLES, PERSONA_TABLES, GLOBAL_TABLES, DRAFT_TABLES } = require('../src/lib/tablas');

describe('registro de tablas', () => {
  test('cada tabla tiene un ámbito válido', () => {
    for (const [nombre, def] of Object.entries(TABLAS)) {
      expect({ nombre, ok: AMBITOS.includes(def.ambito) }).toEqual({ nombre, ok: true });
    }
  });

  test('las listas derivadas no se pisan: una tabla está en un solo ámbito', () => {
    const sets = [SCOPED_TABLES, GLOBAL_TABLES, DRAFT_TABLES];
    for (const t of Object.keys(TABLAS)) {
      expect({ t, listas: sets.filter(s => s.has(t)).length }).toEqual({ t, listas: 1 });
    }
  });

  test('toda tabla personal pasa también por forTenant (SCOPED_TABLES ⊇ PERSONA_TABLES)', () => {
    for (const t of PERSONA_TABLES) expect(SCOPED_TABLES.has(t)).toBe(true);
  });

  test('tenant-db y persona-db usan las listas del registro', () => {
    expect(require('../src/lib/tenant-db').SCOPED_TABLES).toBe(SCOPED_TABLES);
    expect(require('../src/lib/persona-db').PERSONA_TABLES).toBe(PERSONA_TABLES);
  });

  test('las tablas globales y los borradores no se pueden pedir con forTenant', () => {
    for (const t of [...GLOBAL_TABLES, ...DRAFT_TABLES]) expect(SCOPED_TABLES.has(t)).toBe(false);
  });
});

describe('migraciones ↔ registro', () => {
  const dir = path.join(__dirname, '..', 'sql', 'migrations');
  const creadas = new Set();
  for (const archivo of fs.readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    // Sin comentarios, para no leer "create table" dentro de un texto explicativo.
    const sql = fs.readFileSync(path.join(dir, archivo), 'utf8').replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_0-9]+)/gi)) creadas.add(m[1].toLowerCase());
  }

  test('toda tabla creada por una migración está registrada (o es infraestructura)', () => {
    const sinRegistrar = [...creadas].filter(t => !TABLAS[t] && !TABLAS_DE_INFRAESTRUCTURA.has(t));
    expect(sinRegistrar).toEqual([]);
  });

  test('toda tabla registrada (salvo borradores) la crea alguna migración', () => {
    // movimientos, profesionales y profiles nacen antes del sistema de migraciones numeradas (schema inicial).
    const anteriores = new Set(['movimientos', 'profesionales', 'profiles']);
    const sinMigracion = Object.keys(TABLAS).filter(t => TABLAS[t].ambito !== 'borrador' && !anteriores.has(t) && !creadas.has(t));
    expect(sinMigracion).toEqual([]);
  });
});
