#!/usr/bin/env bash
# Aplica todo sql/ contra un Postgres real, dos veces (idempotencia), y exige que
# sql/verificar_estado.sql marque todas las migraciones como aplicadas.
# Uso: DATABASE_URL=postgres://usuario:clave@host/db scripts/probar-sql.sh
# La base debe estar VACÍA y ser descartable. Simula lo mínimo de Supabase
# (roles anon/authenticated/service_role, auth.users y storage.buckets).
set -euo pipefail

: "${DATABASE_URL:?Falta DATABASE_URL (una base descartable)}"
cd "$(dirname "$0")/.."
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY);
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL

# schema.sql y profesionales.sql son el baseline histórico (se corren una sola
# vez); lo que tiene que ser repetible son las migraciones.
"${PSQL[@]}" -f sql/schema.sql
"${PSQL[@]}" -f sql/profesionales.sql

aplicar() {
  for f in sql/migrations/*.sql; do
    echo "  · $f"
    "${PSQL[@]}" -f "$f"
  done
}

echo "Baseline + migraciones (base vacía)"; aplicar
echo "Migraciones otra vez (idempotencia)"; aplicar

echo "Verificando estado"
# La consulta 1 de verificar_estado.sql: ninguna migración puede dar false.
FALTAN=$("${PSQL[@]}" -t -A -c "$(awk '/^-- ── 2\)/{exit} {print}' sql/verificar_estado.sql | grep -v '^--' )" | awk -F'|' '$3 != "t"' || true)
if [ -n "$FALTAN" ]; then
  echo "Migraciones no aplicadas según verificar_estado.sql:"; echo "$FALTAN"; exit 1
fi
# RLS activo en todas las tablas de public.
SIN_RLS=$("${PSQL[@]}" -t -A -c "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity")
if [ -n "$SIN_RLS" ]; then echo "Tablas sin RLS:"; echo "$SIN_RLS"; exit 1; fi
echo "OK: SQL aplica limpio, es idempotente y todo está verificado."
