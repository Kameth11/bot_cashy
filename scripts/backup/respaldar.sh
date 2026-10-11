#!/usr/bin/env bash
# Respaldo de la base de Cashy: volcado de public + recibo de filas, cifrado.
#
# Variables de entorno (obligatorias):
#   SUPABASE_DB_URL     conexión del rol de solo lectura (ver RESPALDOS.md)
#   BACKUP_PASSPHRASE   clave con la que se cifra el volcado (guardarla en un gestor
#                       de contraseñas: sin ella el respaldo no se puede abrir)
# Uso: scripts/backup/respaldar.sh [carpeta_de_salida]   (por defecto ./respaldos)
#
# Deja en la carpeta:
#   cashy-AAAA-MM-DD.dump.gpg     el volcado, cifrado (AES-256)
#   cashy-AAAA-MM-DD.conteo.txt   "tabla filas" por tabla (no tiene datos)
# El volcado sin cifrar se borra siempre, también si algo falla.
set -euo pipefail

: "${SUPABASE_DB_URL:?Falta SUPABASE_DB_URL}"
: "${BACKUP_PASSPHRASE:?Falta BACKUP_PASSPHRASE}"

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
SALIDA="${1:-respaldos}"
FECHA="$(date -u +%F)"
BASE="$SALIDA/cashy-$FECHA"
mkdir -p "$SALIDA"

umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP" "$BASE.dump"' EXIT

psql_() { psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q -A -t "$@"; }

echo "1/5 Comprobando que el rol puede leer todas las tablas…"
SIN_POLITICA="$(psql_ -c "
  SELECT string_agg(c.relname, ', ')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    AND NOT (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user)
    AND NOT EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname = 'public' AND p.tablename = c.relname
                      AND p.cmd IN ('SELECT', 'ALL')
                      AND (current_user = ANY (p.roles) OR 'public' = ANY (p.roles)))")"
if [ -n "$SIN_POLITICA" ]; then
  echo "ERROR: el rol de respaldo no puede leer estas tablas (el volcado saldría incompleto): $SIN_POLITICA" >&2
  echo "       Volvé a correr sql/backup_rol_lectura.sql en Supabase." >&2
  exit 1
fi

echo "2/5 Volcando la base…"
pg_dump --format=custom --no-owner --no-privileges --schema=public \
        --enable-row-security --dbname="$SUPABASE_DB_URL" --file="$BASE.dump"

echo "3/5 Verificando el volcado…"
[ -s "$BASE.dump" ] || { echo "ERROR: el volcado quedó vacío" >&2; exit 1; }
pg_restore --list "$BASE.dump" > "$TMP/indice.txt"
grep -q "TABLE DATA" "$TMP/indice.txt" || { echo "ERROR: el volcado no tiene datos de tablas" >&2; exit 1; }

echo "4/5 Guardando el recibo de filas…"
psql_ -F ' ' -f "$RAIZ/sql/conteo_filas.sql" > "$BASE.conteo.txt"
[ -s "$BASE.conteo.txt" ] || { echo "ERROR: el recibo de filas quedó vacío" >&2; exit 1; }

echo "5/5 Cifrando…"
printf '%s' "$BACKUP_PASSPHRASE" > "$TMP/clave"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$TMP/clave" \
    --symmetric --cipher-algo AES256 --output "$BASE.dump.gpg" "$BASE.dump"

echo "Listo: $BASE.dump.gpg ($(wc -c < "$BASE.dump.gpg") bytes) y $BASE.conteo.txt"
echo "Tablas respaldadas: $(wc -l < "$BASE.conteo.txt"); filas en total: $(awk '{s+=$2} END {print s+0}' "$BASE.conteo.txt")"
