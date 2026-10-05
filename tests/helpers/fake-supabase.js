// Supabase falso EN MEMORIA para tests: tablas con filas, filtros .eq, order, range,
// limit, insert/upsert/update/delete con .select() de retorno, y las restricciones de
// unicidad que importan (legacy_id por tenant, un viaje activo por persona).
// Registra cada consulta en `llamadas` para poder verificar qué filtros se aplicaron.

function crearSupabaseFalso({ errorEn = null } = {}) {
  const tablas = {};
  const llamadas = [];
  let seq = 0;
  const tabla = (n) => (tablas[n] = tablas[n] || []);

  class Query {
    constructor(t, op, payload, opts) {
      this.t = t; this.op = op; this.payload = payload; this.opts = opts || {};
      this.filtros = {}; this.ord = null; this.rng = null; this.lim = null; this.retorna = op === 'select' ? '*' : null;
      this.unica = false;
      llamadas.push(this);
    }
    eq(c, v) { this.filtros[c] = v; return this; }
    order(c, o = {}) { this.ord = [c, o.ascending !== false]; return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    limit(n) { this.lim = n; return this; }
    select(cols) { this.retorna = cols || '*'; return this; }
    single() { this.unica = true; return this; }
    maybeSingle() { this.unica = true; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.ejecutar()).then(res, rej); }

    coincide(fila) { return Object.entries(this.filtros).every(([c, v]) => String(fila[c]) === String(v)); }
    proyectar(filas) {
      if (!this.retorna || this.retorna === '*') return filas.map(f => ({ ...f }));
      const cols = this.retorna.split(',').map(c => c.trim());
      return filas.map(f => Object.fromEntries(cols.map(c => [c, f[c]])));
    }
    devolver(filas) {
      const data = this.proyectar(filas);
      return { data: this.unica ? (data[0] || null) : data, error: null };
    }

    ejecutar() {
      if (errorEn && errorEn.tabla === this.t && errorEn.op === this.op) {
        return { data: null, error: { message: errorEn.mensaje || 'falla simulada', code: errorEn.code || 'XX000' } };
      }
      const filas = tabla(this.t);

      if (this.op === 'select') {
        let r = filas.filter(f => this.coincide(f));
        if (this.ord) {
          const [c, asc] = this.ord;
          r = [...r].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (asc ? 1 : -1));
        }
        if (this.rng) r = r.slice(this.rng[0], this.rng[1] + 1);
        if (this.lim != null) r = r.slice(0, this.lim);
        return this.devolver(r);
      }

      if (this.op === 'insert' || this.op === 'upsert') {
        const entrada = Array.isArray(this.payload) ? this.payload : [this.payload];
        const creadas = [];
        for (const fila of entrada) {
          if (this.op === 'upsert' && this.opts.onConflict) {
            const cols = this.opts.onConflict.split(',');
            const existente = filas.find(f => cols.every(c => String(f[c]) === String(fila[c])));
            if (existente) { Object.assign(existente, fila); creadas.push(existente); continue; }
          }
          const error = violaUnicidad(this.t, filas, fila);
          if (error) return { data: null, error };
          const nueva = { id: `uuid-${++seq}`, created_at: new Date(2026, 0, 1, 0, 0, seq).toISOString(), ...fila };
          filas.push(nueva);
          creadas.push(nueva);
        }
        return this.retorna ? this.devolver(creadas) : { data: null, error: null };
      }

      if (this.op === 'update') {
        const afectadas = filas.filter(f => this.coincide(f));
        afectadas.forEach(f => Object.assign(f, this.payload));
        return this.retorna ? this.devolver(afectadas) : { data: null, error: null };
      }

      if (this.op === 'delete') {
        const borradas = filas.filter(f => this.coincide(f));
        tablas[this.t] = filas.filter(f => !borradas.includes(f));
        return this.retorna ? this.devolver(borradas) : { data: null, error: null };
      }
      return { data: null, error: { message: `op desconocida ${this.op}` } };
    }
  }

  function violaUnicidad(t, filas, fila) {
    const dup = (msg) => ({ message: `duplicate key value violates unique constraint (${msg})`, code: '23505' });
    if ((t === 'movimientos_personales' || t === 'viajes_personales') && fila.legacy_id != null) {
      if (filas.some(f => f.tenant_id === fila.tenant_id && f.legacy_id === fila.legacy_id)) return dup('tenant_id, legacy_id');
    }
    if (t === 'viajes_personales' && fila.estado === 'activo') {
      if (filas.some(f => String(f.user_id) === String(fila.user_id) && f.estado === 'activo')) return dup('un_activo_por_persona');
    }
    return null;
  }

  return {
    llamadas,
    tablas,
    from(t) {
      return {
        select: (cols) => new Query(t, 'select', null).select(cols || '*'),
        insert: (rows) => new Query(t, 'insert', rows),
        upsert: (rows, opts) => new Query(t, 'upsert', rows, opts),
        update: (patch) => new Query(t, 'update', patch),
        delete: () => new Query(t, 'delete', null),
      };
    },
  };
}

module.exports = { crearSupabaseFalso };
