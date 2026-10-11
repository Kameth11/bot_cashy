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
