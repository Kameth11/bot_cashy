# Respaldos de la base de datos

Una copia **cifrada** de la base de Supabase todos los días, guardada en GitHub
(sin cuentas ni tarjetas nuevas), con una forma probada de restaurarla. Existe porque
el plan gratuito de Supabase no garantiza copias (ver `PLAN_BASE_DE_DATOS.md`).

## Qué se respalda y qué no

| Se respalda | NO se respalda (hay que cuidarlo aparte) |
|---|---|
| Todas las tablas de `public`: movimientos, perfiles, permisos, Personal, comprobantes (los datos), tenants, chat | **Los archivos del bucket `comprobantes`** (fotos y PDF originales) |
| La estructura completa: tablas, índices, RLS y políticas | **Google Sheets** (ya tienen su propio historial de versiones en Drive) |
| Un "recibo" con la cantidad de filas de cada tabla | **Las variables y claves de Railway**: guardarlas en un gestor de contraseñas |

## Cómo funciona

Cada día a las 03:17 (hora de Argentina) GitHub Actions corre
`scripts/backup/respaldar.sh`, que se conecta con un **rol de solo lectura**, hace el
volcado, comprueba que no esté vacío, anota cuántas filas tiene cada tabla, lo **cifra
con AES-256** y lo guarda como artefacto de la corrida (`respaldo-AAAA-MM-DD`), 90 días.
Si algo falla, GitHub te manda un mail.

## Puesta en marcha (una sola vez, ~15 minutos)

1. **Crear el rol de solo lectura.** En Supabase → SQL Editor, abrí
   `sql/backup_rol_lectura.sql`, reemplazá `CAMBIAR_ESTA_CLAVE` por una clave larga y
   aleatoria (anotala) y corrélo.
2. **Armar la URL de conexión.** En Supabase → botón **Connect** → **Session pooler**
   (no "Direct": GitHub no puede usar la directa). Copiá la cadena, que se ve así:
   `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<región>.pooler.supabase.com:5432/postgres`
   y cambiá `postgres.<ref>` por **`backup_ro.<ref>`** y la clave por la del paso 1.
3. **Inventar la frase de cifrado.** Una frase larga y aleatoria (20+ caracteres), y
   guardala en tu gestor de contraseñas. **Sin ella los respaldos no se pueden abrir.**
4. **Cargar los dos secretos en GitHub.** Repo → Settings → Secrets and variables →
   Actions → New repository secret:
   - `SUPABASE_DB_URL` = la URL del paso 2
   - `BACKUP_PASSPHRASE` = la frase del paso 3
5. **Primera corrida a mano.** Actions → "Respaldo de la base" → Run workflow. Tiene que
   terminar en verde. Entrá a la corrida y bajá el artefacto `respaldo-AAAA-MM-DD`.
6. **Probar la restauración** (ver abajo). Hacelo una vez: hasta que no se restaura, no
   sabés si el respaldo sirve.

> Mientras no cargues los secretos, el trabajo diario falla a propósito y GitHub te avisa
> por mail. Es lo esperado: un respaldo que no corre no tiene que parecer que anda.

## Restaurar

Siempre en una base **vacía** (el script se niega a pisar datos). Lo más seguro: crear un
**proyecto nuevo** (gratuito) en Supabase y restaurar ahí; recién después decidir qué hacer.

Hace falta `postgresql-client` (versión 17 o más) y `gpg`. En Windows, usar Git Bash o WSL.

```bash
export BACKUP_PASSPHRASE='la frase del paso 3'
scripts/backup/restaurar.sh cashy-AAAA-MM-DD.dump.gpg \
  'postgresql://postgres.<ref>:<clave>@<host-del-proyecto-nuevo>:5432/postgres' \
  cashy-AAAA-MM-DD.conteo.txt
```

Al final tiene que decir **"OK: la base restaurada tiene exactamente las mismas filas que
el recibo"**. Para probar en tu compu con un Postgres común, agregá `SIMULAR_SUPABASE=1`
(crea los roles y esquemas de Supabase que el volcado espera).

Para volver a producción desde el proyecto nuevo, hay que cambiar en Railway
`SUPABASE_URL` y las claves por las del proyecto nuevo. **Los archivos del bucket no
vuelven con esto.**

## Rutina

- **Cada mes:** bajar un respaldo a tu compu o a tu Drive. Es la segunda ubicación: si te
  quedás sin acceso a GitHub, no te quedás sin copias.
- **Cada 3 meses:** probar una restauración completa.
- **Cada vez que se crea una tabla nueva:** volver a correr `sql/backup_rol_lectura.sql`.
  Si te olvidás, el respaldo **falla avisando** qué tabla falta (no sale incompleto en
  silencio).

## Límites y cosas a saber

- **Retención:** 90 días. En un repo privado se puede subir hasta 400 cambiando
  `retention-days` en `.github/workflows/respaldo.yml`.
- **Cuota:** los artefactos cuentan contra el almacenamiento de GitHub Actions de tu cuenta
  (Settings → Billing). Un volcado de esta base pesa poco; si crece mucho, conviene pasar a
  un almacenamiento aparte (Cloudflare R2 o Backblaze B2).
- **Repo público:** GitHub apaga las tareas programadas de un repo público si pasan 60 días
  sin actividad, y los artefactos los puede bajar cualquiera con acceso. Por eso están
  cifrados: usá una frase larga.
- **Seguridad:** GitHub guarda la clave de solo lectura **y** la frase de cifrado. Alguien
  que entre a los secretos de tu repo podría leer los respaldos. Una mejora futura es cifrar
  con clave pública (la privada queda solo en tu poder).
- **Cambiar de versión de Postgres:** si Supabase pasa a una versión mayor que 17, subir
  `PG_CLIENT_VERSION` en el workflow.

## Probado

Con un Postgres 16 real (no con Supabase): respaldo con el rol de solo lectura (no puede
escribir ni borrar), recibo de filas, archivo cifrado sin texto legible, el respaldo falla si
hay una tabla sin política, restauración con las mismas filas, el mismo contenido (huella de
las filas) y las mismas políticas RLS, y las protecciones (base no vacía, clave incorrecta,
archivo dañado, restauración todo-o-nada). **No se pudo probar** el workflow en GitHub
Actions ni contra Supabase real: la primera corrida a mano (paso 5) es esa prueba.
