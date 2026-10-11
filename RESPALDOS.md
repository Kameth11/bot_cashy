# Respaldos propios

Como la base de Supabase es del plan gratuito (sin copias confiables), hay un respaldo
diario propio: `.github/workflows/backup.yml`.

## Qué hace
Todos los días (03:17 de Argentina) y a pedido (Actions → "Backup diario" → Run workflow):
1. `pg_dump` del esquema `public` (formato custom) → `base.dump`.
2. `scripts/backup-comprobantes.js` copia el bucket privado `comprobantes`.
3. Empaqueta, **cifra con AES-256** (gpg) y sube el archivo como artefacto del workflow
   (privado, 30 días). Falla (y avisa por mail de GitHub) si falta un secreto o el volcado sale vacío.

## Configuración (una vez) — Settings → Secrets and variables → Actions
| Secreto | Valor |
|---|---|
| `SUPABASE_DB_URL` | Cadena de conexión **del pooler** (Supabase → Connect → Session pooler). GitHub Actions no tiene IPv6, la conexión directa no anda |
| `BACKUP_PASSPHRASE` | Contraseña larga inventada por vos. **Guardala también en un gestor de contraseñas**: sin ella el respaldo no se puede abrir |
| `SUPABASE_URL` | La misma que Railway |
| `SUPABASE_SERVICE_ROLE_KEY` | La misma que Railway |

El repo tiene que ser **privado** (los artefactos son visibles para quien tenga acceso al repo).

## Restaurar (probar al menos una vez por trimestre)
```bash
gpg --decrypt cashy-backup-AAAA-MM-DD.tar.gz.gpg | tar -xz        # pide BACKUP_PASSPHRASE
pg_restore --no-owner --dbname "$URL_DE_UNA_BASE_DE_PRUEBA" base.dump
# comprobantes/ queda como carpeta; para volver a subirlos, usar Storage del proyecto nuevo.
```
Restaurar **siempre primero en una base de prueba**, nunca encima de producción.

## Límites conocidos
- 30 días de historia, un punto por día (no hay recuperación a un instante exacto).
- El volcado cubre `public` y el bucket `comprobantes`; no incluye usuarios de `auth` (el bot no los usa).
- Los Google Sheets de cada cliente son una segunda copia independiente de los movimientos.
