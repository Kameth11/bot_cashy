#!/usr/bin/env bash
# Restaura un respaldo cifrado en una base VACÍA (nunca pisa datos existentes).
#
#   BACKUP_PASSPHRASE=... scripts/backup/restaurar.sh <cashy-AAAA-MM-DD.dump.gpg> <URL_base_destino> [recibo.conteo.txt]
#
# Pasos recomendados (ver RESPALDOS.md): crear un proyecto NUEVO en Supabase (o una
# base local), restaurar ahí, comparar contra el recibo, y recién después decidir
# qué hacer. Si el destino es un Postgres común (no Supabase) agregar
# SIMULAR_SUPABASE=1: crea los roles y esquemas que el volcado espera (anon,
# authenticated, service_role, auth.users).
set -euo pipefail

: "${BACKUP_PASSPHRASE:?Falta BACKUP_PASSPHRASE}"
ARCHIVO="${1:?Falta el archivo .dump.gpg}"
DESTINO="${2:?Falta la URL de la base destino}"
RECIBO="${3:-}"

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
[ -f "$ARCHIVO" ] || { echo "No existe $ARCHIVO" >&2; exit 1; }

umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
psql_() { psql "$DESTINO" -X -v ON_ERROR_STOP=1 -q -A -t "$@"; }

echo "1/4 Comprobando que la base destino está vacía…"
USADAS="$(psql_ -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
if [ "$USADAS" != "0" ]; then
  echo "ERROR: la base destino ya tiene $USADAS tablas en public. Se restaura solo sobre una base vacía." >&2
  exit 1
fi

if [ "${SIMULAR_SUPABASE:-}" = "1" ]; then
  echo "    (simulando los roles y esquemas de Supabase)"
  psql_ -f "$AQUI/supabase_falso.sql" > /dev/null
fi

echo "2/4 Descifrando…"
printf '%s' "$BACKUP_PASSPHRASE" > "$TMP/clave"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$TMP/clave" \
    --decrypt --output "$TMP/volcado.dump" "$ARCHIVO" \
  || { echo "ERROR: no se pudo descifrar (¿clave incorrecta o archivo dañado?)" >&2; exit 1; }
pg_restore --list "$TMP/volcado.dump" > /dev/null

echo "3/4 Restaurando…"
# El esquema public ya existe en cualquier base: se omite su CREATE SCHEMA. Y todo
# va en UNA transacción: o se restaura completo o no queda nada a medias.
pg_restore --list "$TMP/volcado.dump" | grep -v ' SCHEMA - public ' > "$TMP/lista.txt"
pg_restore --no-owner --no-privileges --single-transaction --use-list="$TMP/lista.txt" \
           --dbname="$DESTINO" "$TMP/volcado.dump"

echo "4/4 Contando filas…"
psql_ -F ' ' -f "$RAIZ/sql/conteo_filas.sql" > "$TMP/restaurado.txt"
if [ -n "$RECIBO" ]; then
  if diff -u "$RECIBO" "$TMP/restaurado.txt"; then
    echo "OK: la base restaurada tiene exactamente las mismas filas que el recibo."
  else
    echo "ERROR: la cantidad de filas NO coincide con el recibo (ver diferencias arriba)." >&2
    exit 1
  fi
else
  cat "$TMP/restaurado.txt"
  echo "(sin recibo para comparar)"
fi
