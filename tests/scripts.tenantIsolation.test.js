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
