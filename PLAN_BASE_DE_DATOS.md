# Plan: una base de datos más seria

Armado el 2026-10-10 a partir de una revisión del esquema SQL, del código que lo
usa y de lo que devolvió la base real. Complementa a `ARCHITECTURE.md` (sección 3,
multi-tenancy, y sección 5, modelo de datos) sin repetirlo: acá está el **orden de
trabajo** y lo que todavía no estaba anotado.

---

## 1. Estado verificado

**Contra la base real (2026-10-10, consulta de tablas y RLS):**

- Existen 11 tablas en `public` y **todas tienen RLS activo**: `chat_historial`,
  `comprobantes`, `movimientos`, `movimientos_personales`,
  `preferencias_ambito_personales`, `presupuestos_personales`, `profesionales`,
  `profiles`, `tenant_requests`, `tenants`, `viajes_personales`.
- `chat_historial` existe: la migración 015 ya se corrió (y por lo tanto la 008).
- **`auth_codes` NO existe**, aunque `src/api/index.js` la usa como fuente de
  verdad de los códigos de acceso al dashboard. Efecto: los códigos viven solo en
  la memoria del servidor (se pierden en cada deploy, no los ve otra instancia) y
  el error al guardarlos no se registra. No está roto, está degradado. Se corrige
  con la migración **016**.
- `movimientos_v2`, `movimiento_eventos_v2`, `obras_sociales` y `prestaciones` no
  existen: son borradores, como dice `ARCHITECTURE.md`.

**Contra el repo (probado en un Postgres 16 real):**

- La historia completa (`schema.sql`, `profesionales.sql` y las migraciones 001 a
  016) se aplica sin errores en ese orden, y 015/016 se pueden volver a correr.
- `sql/verificar_estado.sql` (solo lectura) responde "¿qué migraciones tiene esta
  base?", "¿qué RLS y políticas hay?" y "¿hay datos raros en `movimientos`?".
  Se comprobó que marca falso lo que falta.
- Con RLS y las políticas actuales, `anon` y `authenticated` no ven ni escriben
  nada; solo `service_role` (el backend).

**Lo que está bien** (no tocar): tablas nuevas (Personal, Comprobantes, chat) con
fechas reales, restricciones y claves foráneas; aislamiento por consultorio y por
persona forzado en código (`forTenant`/`forPersona`) con un chequeo estático
(`npm run check:tenant`); `tenant_id` obligatorio; índice que coincide con la
consulta real de movimientos; bucket de comprobantes privado; migraciones que se
pueden repetir.

---

## 2. Decisiones que ya estaban tomadas (el plan las respeta)

- **Google Sheets se queda siempre** como respaldo y vista editable; Supabase es
  la fuente de verdad cuando está activo (`ARCHITECTURE.md` sección 5). Por eso
  este plan **no retira el dual-write**: lo vuelve visible y verificable.
- El backend usa la `service_role` key: el aislamiento es **de aplicación**, no de
  base. Se mantiene así mientras el dashboard no hable directo con Supabase.
- Push directo a `main` mientras sea una sola persona desarrollando.

---

## 3. Plan por fases

Cada fase se puede cortar al terminar sin dejar nada a medias.

### Fase 0 — Hoy (la hacés vos, ~15 minutos)

| # | Acción | Para qué |
|---|---|---|
| 0.1 | Correr `sql/migrations/016_auth_codes_y_rls.sql` en el SQL Editor | Crea `auth_codes` y deja escrito el RLS de `tenants`/`tenant_requests` |
| 0.2 | Correr `sql/verificar_estado.sql` (cada consulta por separado) y guardar el resultado | Saber con certeza qué migraciones tiene la base. Todas deberían dar `true` |
| 0.3 | En Railway, confirmar que existe `SUPABASE_SERVICE_ROLE_KEY` | El backend cae a la `anon` key si falta; con las políticas actuales casi todo fallaría, pero conviene que sea explícito |
| 0.4 | En Supabase, ver qué plan tenés y si hay **copias de seguridad automáticas** (y por cuánto tiempo) | Hay datos financieros de clientes. Sin backup verificado, un error es irreversible |
| 0.5 | **Respaldo propio automático** (el plan gratuito no garantiza copias): seguir `RESPALDOS.md` | Copia diaria cifrada en GitHub, con restauración probada. Armado 2026-10-11; falta que cargues los secretos y hagas la primera corrida |

### Fase 1 — Trazabilidad y red de seguridad (chica; 1–2 sesiones; riesgo bajo)

Objetivo: que nadie tenga que adivinar qué tiene la base, y que una migración rota
no llegue a producción.

1. **Registro de migraciones**: tabla `schema_migrations(version, descripcion,
   aplicada_en)` (migración 017) cargada con lo que dé `verificar_estado.sql`, y
   convención: cada migración nueva se inserta a sí misma al final.
2. **CI contra un Postgres real**: sumar a `.github/workflows/ci.yml` un job que
   levanta Postgres, simula los roles/esquemas de Supabase (`anon`, `service_role`,
   `auth`, `storage`), corre todo `sql/` en orden, lo corre dos veces (idempotencia)
   y ejecuta `verificar_estado.sql` exigiendo todo en `true`. Es exactamente lo que
   se hizo a mano para validar la 016.
3. **Errores de `auth_codes` visibles**: `supabase-js` no lanza, devuelve
   `{ error }`; hoy `request-code` y `verify` no lo miran. Mirar `.error` y loguear.
4. **Clave de servicio explícita**: al arrancar con Supabase activo y sin
   `SUPABASE_SERVICE_ROLE_KEY`, avisar fuerte (y, si se decide, negarse a arrancar
   en producción) en vez de caer en silencio a la `anon`.
5. **Limpieza del repo**: mover `schema_v2_draft.sql` y `schema_mvp_odontologia.sql`
   a `sql/borradores/`; unificar la definición de `profesionales` (hoy hay dos);
   marcar `schema.sql` como "baseline histórico"; un `sql/README.md` con el orden de
   ejecución; sacar `@supabase/supabase-js` y `dashboard/src/services/supabase.js`
   del dashboard (código muerto: nada lo importa y no va en el bundle).
6. **Códigos de acceso con hash** (opcional): guardar un hash en `auth_codes` en
   vez del código en claro. Vencen a los 10 minutos y tienen límite de intentos, así
   que es endurecimiento, no urgente.

### Fase 2 — Consistencia de `movimientos` (mediana; riesgo medio; con backup previo)

`movimientos` es la tabla más vieja y la más floja: `fecha` y `hora` son **texto**
("DD/MM/AAAA"), y `estado`/`tipo`/`moneda` no tienen restricciones. Las tablas
personales ya lo hacen bien. Se corrige **agregando, no reemplazando**, para que
el código actual siga andando en cada paso:

1. Correr la consulta 3 de `verificar_estado.sql` (¿hay valores raros o fechas con
   otro formato?). Limpiar a mano lo que aparezca antes de seguir.
2. **Columna `fecha_iso DATE`** con backfill desde el texto, y que el código la
   mantenga al escribir. Índice `(tenant_id, fecha_iso)`.
3. **Restricciones** (`CHECK`) en estado, tipo y moneda (`Pesos`, `Dólares`,
   `Euros`), primero como `NOT VALID` y después `VALIDATE`.
4. **Filtrar por mes en la base** en vez de traer todo y filtrar en memoria; recién
   ahí deprecar el texto.

### Fase 3 — Que Sheets y Supabase no se desvíen sin que nadie lo note (mediana)

Hoy las escrituras van a los dos lados y, si falla uno, el error queda silenciado.
No se retira Sheets (ver sección 2); se lo hace **verificable**:

1. **Reconciliador**: comando de admin (o tarea programada) que compara cantidad y
   suma de movimientos por persona y por mes entre Sheets y Supabase y lista las
   diferencias.
2. **Fallos del dual-write visibles**: contarlos, loguearlos con contexto y avisar
   al admin por Telegram cuando se acumulen.
3. **Lectura primero desde Supabase** donde todavía no sea así, con Sheets como
   respaldo que se actualiza en segundo plano (ya existe `runInBackground`).

### Fase 4 — Listo para vender a otros consultorios (grande; depende de la decisión de negocio)

Se apoya en las etapas ya descritas en `ARCHITECTURE.md` sección 3 y 4:

1. **Identidad propia**, desacoplada del ID de Telegram (ID negativo para cuentas
   nuevas, ver sección 4 de `ARCHITECTURE.md`).
2. **Tabla de miembros** (`tenant_miembros`: persona, consultorio, rol, permisos) en
   lugar de `profiles.usuarios BIGINT[]` + `permisos JSONB`: da integridad
   referencial y permite consultar "quién puede qué".
3. **Alta autoservicio** de consultorios (`tenant_requests` ya existe como base;
   `ALLOWED_EMAILS` sigue en `.env`).
4. **Defensa en profundidad**: si algún día el dashboard habla directo con Supabase,
   pasar a RLS por consultorio con claims del JWT. Mientras siga la `service_role` +
   wrappers, mantener `check:tenant` como regla.
5. **Ambiente de pruebas**: un proyecto de Supabase aparte (staging) con sus propias
   variables, para probar migraciones y datos sin tocar al cliente real.
6. **Backups con restauración de prueba** al menos una vez por trimestre: un backup
   que nunca se restauró no es un backup.

### Operación continua (en paralelo a las fases)

- Rotar las claves de Supabase si alguna vez se compartieron o se pegaron en un chat.
- Mirar de vez en cuando el tamaño de la base y las conexiones contra los límites
  del plan.
- El historial del chat ya se acota solo (150 mensajes, 30 días).
- Datos reales en el repo: la migración `002_backfill_tenants.sql` tiene IDs de
  Telegram y un email reales escritos a mano. Es razonable si el repo es privado; si
  alguna vez deja de serlo, hay que sacarlos.

---

## 4. Orden recomendado

| Orden | Fase | Esfuerzo | Riesgo | Por qué en ese lugar |
|---|---|---|---|---|
| 1 | 0 | 15 min | nulo | Cierra lo que está degradado hoy y da certeza |
| 2 | 1 | 1–2 sesiones | bajo | Es lo que más reduce el riesgo de las fases siguientes |
| 3 | 2 | 1–2 sesiones | medio | Sin esto, los reportes por fecha no escalan |
| 4 | 3 | 1–2 sesiones | medio | Evita diferencias silenciosas entre Sheets y Supabase |
| 5 | 4 | varias semanas | alto | Solo si se decide vender; define el resto del roadmap |

Las fases 1 a 3 se pueden hacer sin cambiar nada de lo que ve el cliente.

## 5. Decisiones que necesito de vos

1. **¿Vender a otros consultorios pronto?** Si sí, la fase 4 sube de prioridad y
   conviene adelantar staging y backups.
2. **Clave de servicio**: ¿que el backend **avise** si falta, o que **se niegue a
   arrancar** en producción? (Lo segundo es más seguro, pero un error de
   configuración tira el servicio.)
3. **¿El repo es privado?** Define qué hacer con los datos reales de la migración 002.
4. **Fase 2**: ¿te parece bien agregar `fecha_iso` y las restricciones en
   `movimientos`, previa copia de seguridad?

## 6. Hecho hasta ahora

- Migración **016** (`auth_codes` + RLS explícito en `tenants`/`tenant_requests`).
- `sql/verificar_estado.sql` (solo lectura).
- Validación de toda la historia SQL en un Postgres 16 real, incluida la
  repetición de 015/016 y el acceso por rol.
- **Fase 1 completa** (2026-10-11): migración **017** (`schema_migrations`); job
  `sql-postgres` en CI y `scripts/probar-sql.sh` (baseline + migraciones dos veces +
  `verificar_estado.sql` + RLS en todas las tablas); la 003 pasó a ser idempotente;
  `.error` de `auth_codes` ahora se loguea; `verificarClaveServicio` avisa fuerte si
  falta la service role key (y con `SUPABASE_REQUIRE_SERVICE_KEY=true` no arranca);
  `schema_v2_draft.sql` movido a `sql/borradores/`, `sql/README.md` con el orden;
  se sacó del dashboard el código muerto de Supabase. Quedó pendiente (opcional):
  unificar las dos definiciones de `profesionales` y el hash de `auth_codes`.
- **Respaldo propio** (fase 0.5): workflow diario cifrado con rol de solo lectura y restauración probada, ver `RESPALDOS.md`. Los archivos del bucket `comprobantes` quedan pendientes (script listo, sin conectar).
- **Dockerfile** (sección 7): imagen única bot + API + dashboard. No se pudo construir
  acá (sin daemon de Docker): probarlo con `docker build .` antes de depender de él.

- **Fase 3, puntos 1 y 2** (2026-10-11): `/reconciliar` (`reconciliacion.service.js`, solo
  lee: cruza por `ID_Unico`, detecta faltantes de cada lado, montos distintos y meses que no
  cierran) y `dual-write-fallos.service.js` (cuenta y loguea cada escritura doble fallida y
  avisa al admin por Telegram a partir de 3 en una hora, máximo un aviso por hora). Falta el
  punto 3 (leer primero de Supabase donde aún no sea así) y **correr `/reconciliar` en
  producción** para ver cuántas diferencias hay antes de decidir cómo corregirlas.

- **Fase 2, puntos 1 a 3** (2026-10-11): migración **018** (`movimientos.fecha_iso DATE`,
  calculada por un trigger desde `fecha` —acepta `AAAA-MM-DD` y `DD/MM/AAAA`—, rellenada
  para las filas viejas, con índice `(tenant_id, fecha_iso)`; no cambia el código) y
  migración **019** (CHECK `NOT VALID` en estado/tipo/moneda; `tipo` sin distinguir
  mayúsculas porque el código escribe `ingreso`/`egreso`). `verificar_estado.sql` consulta 3
  corregida (marcaba como raro el `tipo` en minúscula). Probado en Postgres 16 con datos
  mezclados. **Orden para producción:** respaldo reciente → consulta 3 (estado/tipo/moneda
  raros en 0) → 018 → 019 → `SELECT count(*) FROM movimientos WHERE fecha_iso IS NULL`
  → cuando todo dé 0, los `VALIDATE CONSTRAINT` que están en el encabezado de la 019.
  Falta el punto 4 (filtrar por mes en la base en vez de traer todo): recién conviene
  hacerlo con `fecha_iso` ya verificada en producción.

## 6.b Pendiente de tu lado y decisiones abiertas (traspaso 2026-10-11)

**Lo que tiene que hacer el usuario (Claude no puede):**
1. Correr `016` y `017` en Supabase y después `sql/verificar_estado.sql` (todo `true`).
2. Seguir `RESPALDOS.md`: rol `backup_ro` (`sql/backup_rol_lectura.sql`), secretos `SUPABASE_DB_URL` y `BACKUP_PASSPHRASE`, primera corrida a mano y una restauración de prueba.
3. Confirmar que Railway tenga `SUPABASE_SERVICE_ROLE_KEY`.
4. Probar en producción: audio largo con nombre + monto + método (si sale cortado, mirar
   en el log de Railway la línea "transcripcion de audio … termino con …"); foto de
   factura y de transferencia; un gasto de Casa y uno personal.
5. Probar `docker build .` y correr la imagen con el `.env`.

**Decisiones abiertas:** ¿se vende pronto a otros consultorios (sube la fase 4)? ¿el
repo es privado (migración 002 tiene IDs y un email reales)? ¿negarse a arrancar sin
service key en producción (`SUPABASE_REQUIRE_SERVICE_KEY=true`) o solo avisar? (`fecha_iso` y restricciones ya preparadas en 018/019: falta correrlas con respaldo previo.)

**Siguiente:** punto 4 de la fase 2, punto 3 de la fase 3, fase 4
(SaaS, solo si se decide vender). Producto: app en tiendas (Android primero, ver notas),
push, login sin Telegram, deshacer en Personal/Casa/Agenda.

---

## 7. Si algún día hay que cambiar de proveedor (Supabase / Railway)

Relevado el 2026-10-11. **No hace falta mudarse hoy**; esto es para decidir con calma.
Los precios salen de blogs de terceros (los oficiales no se pudieron abrir) y
cambian seguido: confirmarlos en las páginas oficiales antes de decidir.

**Lo que condiciona cualquier mudanza**

- **El código usa Supabase por su API REST** (`supabase-js`, unas 70 llamadas
  `.from(...)`), no SQL directo. Cambiar de base obliga a reescribir el acceso a
  datos. Está centralizado en `lib/tenant-db.js` y `lib/persona-db.js`, así que es
  factible, pero no es una mudanza de un día.
- **Los comprobantes usan Supabase Storage** (bucket privado `comprobantes`): habría
  que reemplazarlo (S3, Cloudflare R2, etc.).
- **La app es un único proceso con estado en memoria** (sesiones del bot, historial
  del chat, límites de uso) y el bot usa long polling: **no puede correr en dos
  instancias a la vez ni "dormirse"**. Descarta plataformas que escalan a cero
  (Cloud Run con mínimo 0, funciones serverless). Para crecer más allá de una
  instancia hay que sacar ese estado a Redis y pasar el bot a webhooks.

**Base de datos**

| Opción | Cuándo conviene |
|---|---|
| **Quedarse en Supabase y pasar a Pro** (≈ US$ 25/mes; copias diarias de 7 días; PITR como extra; tope de gasto activo por defecto) | Es el camino de menor esfuerzo y menos sorpresas: no hay que tocar el código. **Recomendado.** |
| Neon (Postgres serverless) | Si se quiere ramas de la base para pruebas; requiere reescribir el acceso a datos y el Storage |
| Postgres administrado de una nube grande (AWS RDS, Google Cloud SQL) | La opción más "sólida" y predecible, con más trabajo y costo base; requiere reescribir acceso y Storage |
| Postgres propio (en Railway o un VPS) | Evitar: los backups pasan a ser responsabilidad tuya |

**Hosting de la app**

| Opción | A favor | En contra |
|---|---|---|
| **Railway** (hoy; Hobby ≈ US$ 5, Pro ≈ US$ 20 + uso) | Cómodo y barato para uso bajo | Cobro por uso: puede subir con el tráfico. Configurar alertas y límite de gasto |
| Render (precio fijo por servicio, ≈ US$ 7–25) | El más predecible | Cambió su estructura de precios el 2026-08-01; la base se cobra aparte |
| DigitalOcean App Platform (precio fijo) | Predecible | Menos cómodo |
| Fly.io | Barato, pago por segundo | Más trabajo de operación |

**Cómo reducir la dependencia hoy, sin mudarse**

1. Agregar un `Dockerfile` (hoy se construye con Railpack): hace el cambio de
   hosting casi trivial.
2. Poner el Storage detrás de una interfaz propia (hoy lo toca
   `comprobante-archivo.service.js`).
3. Mantener volcados propios de la base (`pg_dump`) y de los comprobantes: sirven
   de backup y de plan de salida.
4. Mantener el acceso a datos detrás de los wrappers `forTenant`/`forPersona`.

**Cuándo mudarse (disparadores)**: llega el segundo cliente que paga; la base se
acerca a 500 MB (tope del plan gratuito); hace falta recuperación a un instante
exacto; el costo o los límites de un proveedor dejan de cerrar.
