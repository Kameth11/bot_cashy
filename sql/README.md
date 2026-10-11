# sql/

Orden de ejecución en una base **nueva** (Supabase → SQL Editor, o `psql`):

1. `schema.sql` — baseline histórico (profiles, movimientos v1). Se corre una sola vez.
2. `profesionales.sql` — baseline de `profesionales`. Una sola vez.
3. `migrations/001 … NNN` — en orden. Todas son **idempotentes** (se pueden repetir).
4. `verificar_estado.sql` — solo lectura; cada consulta por separado. Todo debe dar `true`/0.

En una base **existente** solo corren las migraciones que falten (ver `schema_migrations`
desde la 017, o `verificar_estado.sql`). Cada migración nueva se inserta a sí misma en
`schema_migrations` al final (convención en `017_schema_migrations.sql`).

Otros archivos:

- `schema_mvp_odontologia.sql` — definición histórica del modelo v1 (incluye una
  `profesionales` anterior; la vigente es `profesionales.sql` + migración 010).
- `migration_campos_extendidos_movimientos.sql` — migración suelta anterior a `migrations/`.
- `borradores/` — propuestas **no aplicadas** (p. ej. `schema_v2_draft.sql`). No correr.

CI (`.github/workflows/ci.yml`, job `sql-postgres`) y `scripts/probar-sql.sh` aplican
todo esto contra un Postgres real, dos veces, y exigen que `verificar_estado.sql` dé verde.
Para probarlo local: `DATABASE_URL=postgres://… scripts/probar-sql.sh` (base **vacía y descartable**).
