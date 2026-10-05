// El guard de aislamiento de tenant (scripts/check-tenant-isolation.js) usa una
// lista cerrada: una tabla nueva o dinámica sin clasificar tiene que hacer
// fallar el build.

const { analizarContenido } = require('../scripts/check-tenant-isolation');
const scoped = new Set(['movimientos', 'profesionales']);
const ok = (code) => analizarContenido(code, { scoped });

test('tabla de negocio vía forTenant: ok', () => {
  expect(ok("const r = await forTenant(t)\n  .from('movimientos')\n  .select('*');")).toEqual([]);
});

test('tabla de negocio con cliente directo: falla', () => {
  const p = ok("await supabase.from('movimientos').select('*');");
  expect(p).toHaveLength(1);
  expect(p[0].motivo).toMatch(/forTenant/);
});

test('tabla global conocida (profiles): ok', () => {
  expect(ok("await supabase.from('profiles').select('*');")).toEqual([]);
});

test('tabla NUEVA sin clasificar: falla (antes pasaba sin aviso)', () => {
  const p = ok("await supabase.from('facturas').select('*');");
  expect(p).toHaveLength(1);
  expect(p[0].motivo).toMatch(/sin clasificar/);
});

test('tabla dinámica: falla salvo tenant-isolation-ignore', () => {
  expect(ok('await supabase.from(tabla).select("id");')).toHaveLength(1);
  expect(ok('// tenant-isolation-ignore: sonda\nawait supabase.from(tabla).select("id");')).toEqual([]);
});

test('.rpc() no cubierto: falla salvo ignore', () => {
  expect(ok("await supabase.rpc('sumar_todo');")).toHaveLength(1);
  expect(ok("// tenant-isolation-ignore: x\nawait supabase.rpc('f');")).toEqual([]);
});

test('Buffer.from / Array.from no son consultas', () => {
  expect(ok("const b = Buffer.from(x); const a = Array.from(y);")).toEqual([]);
});

test('el repo real pasa el guard', () => {
  const { execFileSync } = require('child_process');
  expect(() => execFileSync('node', ['scripts/check-tenant-isolation.js'], { stdio: 'pipe' })).not.toThrow();
});

// ── Tablas del ámbito PERSONAL: solo con forPersona() ────────────────────────
// Dentro de un tenant conviven varias personas y lo personal es de cada una: forTenant
// solo no alcanza, hace falta el filtro por user_id que garantiza forPersona().
const scopedConPersonales = new Set(['movimientos', 'movimientos_personales', 'preferencias_ambito_personales']);
const okP = (code, extra = {}) => analizarContenido(code, { scoped: scopedConPersonales, ...extra });

describe('tablas personales', () => {
  test('con forTenant directo: falla (no filtra por persona)', () => {
    const p = okP("await forTenant(t)\n  .from('movimientos_personales')\n  .select('*');");
    expect(p).toHaveLength(1);
    expect(p[0].motivo).toMatch(/forPersona/);
  });

  test('con forPersona en la ventana: ok', () => {
    expect(okP("await forPersona(t, u)\n  .from('movimientos_personales')\n  .select('*');")).toEqual([]);
  });

  test('archivo que importa persona-db y NO usa forTenant (cliente en una variable): ok', () => {
    const code = "const { forPersona } = require('../lib/persona-db');\nconst p = forPersona(t, u);\nawait p.from('preferencias_ambito_personales').select('*');";
    expect(okP(code)).toEqual([]);
  });

  test('archivo que importa persona-db pero TAMBIÉN usa forTenant: falla (mezcla prohibida)', () => {
    const code = "const { forPersona } = require('../lib/persona-db');\nconst p = forPersona(t, u);\nawait forTenant(t).from('x');\nawait p.from('movimientos_personales').select('*');";
    expect(okP(code)).toHaveLength(1);
  });

  test('sin importar persona-db y con cliente en variable: falla', () => {
    expect(okP("await p.from('movimientos_personales').select('*');")).toHaveLength(1);
  });

  test('el archivo legado (espejo del modo sheets) puede usar forTenant directo', () => {
    expect(okP("await forTenant(t)\n  .from('movimientos_personales')\n  .select('*');", { personaLegacy: true })).toEqual([]);
  });

  test('una tabla de negocio común sigue pidiendo solo forTenant', () => {
    expect(okP("await forTenant(t)\n  .from('movimientos')\n  .select('*');")).toEqual([]);
  });

  test('el repo real del código fuente cumple la regla', () => {
    const fs = require('fs');
    const path = require('path');
    const archivo = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'personal-repo.supabase.js'), 'utf8');
    expect(analizarContenido(archivo)).toEqual([]);
    expect(archivo).not.toMatch(/forTenant\(/);
  });
});
