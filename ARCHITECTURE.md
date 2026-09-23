# Arquitectura, Seguridad y Camino a Multi-Tenant — Cashy

> Este documento es el punto de partida obligatorio antes de implementar
> cualquier ítem del roadmap de producto (`ROADMAP_CASHY_CLINICA.md`). Define
> las reglas de arquitectura y seguridad que toda feature nueva tiene que
> respetar, y el plan concreto para pasar de "un consultorio" a "SaaS
> multi-tenant real". Es un documento vivo — actualizarlo cuando se cierre una
> fase o cambie una decisión.
>
> `CLAUDE.md` da el contexto general del proyecto y linkea acá para todo lo
> que sea decisión de arquitectura/seguridad/negocio a mediano plazo.

---

## 1. Visión y alcance del producto

Cashy hoy tiene **un cliente real** (el consultorio actual) pero la intención
de negocio confirmada es **venderlo a otros consultorios** — es decir, pasar
de "bot a medida" a **SaaS multi-tenant**. Esto cambia el peso relativo de
varias decisiones técnicas (aislamiento de datos, onboarding, RLS) que en un
proyecto de un solo cliente serían secundarias.

Interfaces: bot de Telegram (carga rápida diaria) + dashboard web (gestión,
edición, reportes). Ambas conviven y se complementan, ninguna reemplaza a la
otra.

---

## 2. Arquitectura actual (snapshot técnico)

- **Un solo servicio** en Railway corre todo: bot (Telegraf) + API Express +
  dashboard estático (build de Vite servido por el mismo Express).
- **Storage dual**: Google Sheets es la base siempre activa (un Sheet por
  "cliente"); Supabase es opcional (`USE_SUPABASE=true`) y cuando está
  activo es la fuente de verdad primaria, con dual-write a Sheets como
  respaldo/vista editable.
- **Auth**: Telegram (email contra allowlist + código de invitación) para el
  bot; código de 6 dígitos por Telegram + JWT de 180 días para el dashboard.
- **Detalle de cada capa**: ver skills `bot-cashy-arquitectura`,
  `bot-cashy-db`, `bot-cashy-nlp` — no se duplica acá.
- **CI**: GitHub Actions corre tests + build en cada push a `main`, notifica
  a Discord. No bloquea el push ni el deploy (ver sección 6).

---

## 3. Multi-tenancy: estado real y plan

### Qué hay hoy (y por qué no alcanza para SaaS)

- **No existe el concepto de "tenant"/organización** en el modelo de datos.
  Todo está keyed por `userId` de Telegram, flat, sin agrupación.
- **`ALLOWED_EMAILS` vive en una variable de entorno.** Dar de alta un email
  nuevo requiere editar `.env` en Railway y que el servicio redeploye. Esto
  es un bloqueante duro para self-service — nadie externo puede entrar sin
  que el dueño del repo intervenga manualmente.
- **Onboarding es 100% manual y pegado a Google Sheets**: cada usuario tiene
  que crear su propio Sheet, compartirlo con la service account, y pegar el
  `sheetId` en el bot. No hay creación automática de Sheets (no se usa la
  Drive API para esto).
- **El aislamiento entre usuarios es solo de aplicación, no de base de
  datos.** `sql/schema.sql` tiene políticas RLS definidas (`web_user_id =
  auth.uid()`), pero el backend se conecta con la **service role key**, que
  **saltea RLS por completo** (así lo dice el propio comentario en el
  schema). En la práctica, lo único que evita que un usuario vea datos de
  otro es que cada función de `db.service.js` filtra por `userId` a mano. Un
  bug en una sola query rompe el aislamiento — no hay una segunda capa de
  defensa a nivel de base de datos. Para un solo cliente esto es un riesgo
  aceptable; **para SaaS con clientes pagos externos, no lo es.**
- **El concepto de "invitado"** (`/unir CODIGO`) no es una organización
  real — es un array `usuarios` informal en `clientes.json`, dentro del
  registro del owner. Desde 2026-09-23 el invitado **no** tiene su propio
  Sheet (ver sección 8, ítem 2.1): usa el del owner, acotado por permisos
  granulares. Invitados dados de alta antes de ese fix pueden tener un
  registro propio legacy (con su propio `sheetId`) que ya no se usa para
  resolver identidad — la resolución mira primero el `ownerId` explícito de
  ese registro, así que no queda huérfano ni compite con la membresía en
  `usuarios[]`.

### Plan por fases (en orden, cada una habilita la siguiente)

**Fase 1 — Sacar el allowlist del `.env` (prerrequisito de todo lo demás)**
- Mover `ALLOWED_EMAILS` a una tabla en Supabase (ej. `tenant_requests` con
  estado `pendiente`/`aprobado`/`rechazado`).
- El alta sigue requiriendo aprobación manual (decisión tomada: por ahora
  seguís aprobando cada cliente nuevo) — pero "aprobar" pasa a ser un
  comando de Telegram admin o un toggle en el dashboard, no editar `.env` y
  esperar un redeploy.
- Esto por sí solo ya destraba self-service parcial: el cliente puede pedir
  acceso sin que nadie toque código.

**Fase 2 — Tenant como entidad explícita + RLS real**
- Agregar tabla `tenants` (o `organizaciones`) en Supabase. Cada `profile`/
  `movimiento` pasa a tener `tenant_id`, no solo `user_id` de Telegram.
- Migrar las policies de RLS para que filtren por `tenant_id` y, más
  importante, **dejar de usar la service role key para las queries que
  vienen de request de usuario** (usar un cliente Supabase con el JWT del
  usuario, o al menos agregar el filtro de `tenant_id` server-side de forma
  consistente y auditada). El objetivo es que el aislamiento no dependa
  100% de que cada desarrollador recuerde filtrar bien en cada función.
- Esto es lo que de verdad separa "un cliente" de "SaaS multi-tenant".

**Estado de implementación (2026-06-24): completa** para las tablas
reales (`profiles`, `movimientos`, `profesionales`). Se optó por el
camino de filtrado server-side centralizado y auditado (no Supabase
Auth/RLS por `auth.uid()` — el bot de Telegram no tiene login
tradicional, hubiera significado rehacer auth desde cero). Implementado:
- `tenants` + `tenant_id NOT NULL` en las 3 tablas, con 2 tenants reales
  hoy (consultorio principal + invitado, y un segundo cliente).
- `src/lib/tenant-db.js` (`forTenant(tenantId)`): única forma permitida
  de tocar tablas de negocio. `scripts/check-tenant-isolation.js` corre en
  CI y falla el build si aparece una query fuera de ese wrapper.
- `src/services/tenant.service.js` (`resolveTenantId`): resuelve
  `tenantId` desde un Telegram ID (owner o invitado), con cache en
  memoria.
- `ensureProfile` (`db.service.js`) crea/hereda el tenant correcto al
  onboardear un perfil nuevo (agrupando por `sheet_id`), así que clientes
  futuros no necesitan backfill manual.
- RLS en `profiles`/`movimientos`/`profesionales`: policy que solo
  permite `service_role` (no filtra por tenant a nivel de Postgres —
  ver más abajo). Cierra el acceso directo con `anon_key`, no protege
  contra un bug en el wrapper de aplicación.
- Se cerró una fuga cross-tenant real que existía antes de esto:
  `profesional.service.js` buscaba profesionales por nombre sin filtrar
  por consultorio.

**TODO:** si/cuando se activen `movimientos_v2`/`movimiento_eventos_v2`/
`obras_sociales`/`prestaciones` (hoy son esquemas draft que nunca se
crearon en producción), sumarles `tenant_id` e incluirlas en
`SCOPED_TABLES` de `tenant-db.js` en ese momento, no antes.

**No implementado a propósito (documentado como Fase 2.6/3 a futuro):**
RLS real con `auth.uid()`/claims propios vía `set_config` por
transacción — solo vale la pena con más de un desarrollador tocando el
código o un volumen de tenants donde un bug de aislamiento sea
catastrófico, no para vender al segundo/tercer cliente.

**Fase 3 — Onboarding automático**
- Dado que la decisión es mantener Sheets para siempre como respaldo, esta
  fase es la que más esfuerzo concentra: automatizar la creación del Sheet
  del tenant nuevo (Drive API `files.create` + compartir con la service
  account y con el email del cliente) en vez de pedirle al cliente que cree
  y comparta el suyo. Sin esto, "self-service" sigue teniendo un paso manual
  molesto.
- Alternativa más simple si se quiere acelerar: ofrecer Sheets como opción
  "avanzada"/opcional y que el onboarding estándar sea Supabase-only (el
  cliente puede pedir su Sheet de respaldo después, no en el alta).

**Fase 4 — Billing/suscripción**
- Todavía no decidido (proveedor, modelo de precio, etc.) — placeholder a
  definir antes de cobrarle a un cliente externo real. No bloquea el
  trabajo técnico de las fases 1-3.

### Regla para features nuevas mientras dura la transición

Antes de implementar cualquier feature nueva del roadmap de producto,
preguntarse:
1. ¿Esta feature asume que hay un solo tenant, o ya contempla que puede
   haber varios? (si asume uno solo, hay que diseñarla pensando en que
   `tenant_id` puede llegar a existir, aunque hoy no exista — no cerrar
   puertas).
2. ¿Toca el modelo de auth o de datos de forma que requiera RLS nueva?
3. ¿Depende de que `ALLOWED_EMAILS` siga siendo una env var? Si sí, es buen
   momento para empujar la Fase 1 en simultáneo.

---

## 4. Seguridad: estado y mejoras pendientes

### Ya implementado

- Logger centralizado con redacción automática de secretos (`src/lib/logger.js`).
- `JWT_SECRET` obligatorio, sin fallback inseguro (falla el arranque si falta).
- Rate limiting en `/api/auth/request-code` y `/api/auth/verify`.
- Auditoría de eventos sensibles (login, CRUD de movimientos vía dashboard).
- Mutex de escritura por usuario (`src/lib/write-queue.js`) — evita race
  conditions Sheets/Supabase entre bot y dashboard.
- CI con tests + build en cada push, notificación a Discord.
- **Permisos granulares aplicados también en el bot de Telegram**
  (`src/auth/bot-permisos.js`), no solo en la API del dashboard. Antes de
  esto, un invitado con un único permiso (ej. `ver_agenda`) podía usar
  cualquier comando de plata o agenda por Telegram sin restricción — la
  única capa de permisos vivía en `requierePermiso` de `src/api/index.js`.
  Mismo criterio y misma fuente (`resolverPermisos`) en ambos lados; el
  detalle del mapeo comando/intent → permiso vive en el skill
  `bot-cashy-arquitectura`.
- **Finanzas personales restringidas a dueño/admin** en las cuatro
  superficies donde se podían tocar: `/api/personal/*` (`ownerOnly`),
  `/personal` y `/viaje` del bot (`requiereDuenoBot`), la detección
  automática de ámbito y el botón "Es personal" de la confirmación NLP, y
  la sección Personal del dashboard (oculta si `!isOwner && !isAdmin`).
  Antes, `getSheetId` resolvía a cualquier invitado al sheet del dueño sin
  ningún chequeo adicional, así que un invitado podía leer/cargar/borrar
  las finanzas personales del dueño.
- **`DASHBOARD_DEV_TOKEN` limitado a `NODE_ENV=development`**, comparado con
  `crypto.timingSafeEqual` en vez de `===`, y con un `logger.warn` al
  arrancar la API si queda seteada fuera de development. Antes, cualquiera
  que conociera ese valor entraba como cualquier usuario (incluido el
  admin) en cualquier entorno.
- **Código de acceso al dashboard: 10 minutos de validez (antes 24h) y se
  invalida a los 5 intentos fallidos** (`MAX_INTENTOS_CODIGO`, el mismo
  límite que ya usaba `/unir`). Antes, un código de 6 dígitos numéricos
  quedaba vigente un día entero sin límite de intentos — fuerza bruta
  viable en esa ventana.
- **Modo Full IA (OpenRouter) restringido a dueño/admin**: `/api/config/modo-ia`
  (`ownerOnly`) y `/modoia` del bot (`requiereDuenoBot`, solo al activar/
  desactivar — ver el estado con `/modoia` sin argumento sigue abierto a
  cualquier miembro). Antes, cualquier invitado podía prenderlo o apagarlo
  para todo el consultorio, generando costo real en OpenRouter.
- **Resolución de invitados determinística** (`obtenerClientePorUserId`,
  `src/auth/index.js`): antes dependía del orden de iteración de las claves
  numéricas de `clientes` (`Object.entries` en un objeto con IDs de Telegram
  itera en orden ascendente, no de inserción), así que un invitado con ID
  numéricamente menor al del dueño resolvía como dueño de su propio sheet
  con permisos completos en vez de invitado acotado. Se decidió el modelo
  definitivo: **el invitado usa el sheet del dueño, sin uno propio**
  (`/unir` ya no le pide configurar un spreadsheet); la resolución prioriza
  un `ownerId` explícito en el registro del usuario por sobre el orden de
  iteración. De paso, `eliminarCliente` (`/salir`) ahora también saca al
  usuario de `usuarios[]` de cualquier dueño donde figure — antes solo
  borraba su registro propio, así que un invitado que se daba de baja
  conservaba el acceso.
- **Persistencia de clientes en Supabase (`profiles`), corregida.**
  `buildProfileRow` (`cliente.service.js`) nunca incluía `tenant_id`, que es
  `NOT NULL` desde la migración 003 — el upsert de cualquier perfil NUEVO
  fallaba por constraint violation. Como supabase-js devuelve `{ error }` en
  vez de lanzarlo, y el try/catch alrededor solo atrapa excepciones reales,
  la falla era 100% silenciosa: el usuario quedaba sin fila en `profiles`
  y nada lo registraba. Como `clientes.json` (el respaldo local) se borra en
  cada deploy de Railway, un usuario que se registraba pero no llegaba a
  cargar ningún movimiento antes del próximo deploy (`ensureProfile` nunca
  corría para él) perdía el alta por completo.
  - Se agregó `src/services/tenant-provisioning.service.js`
    (`resolveOrCreateTenantId`, extraído de `db.service.js` a un módulo sin
    dependencias internas para que `cliente.service.js` pueda usarlo sin
    crear un require circular vía `auth/index.js`).
  - `guardarClientes` ahora recibe qué usuario(s) cambiaron y solo sube esa
    fila (con `tenant_id` resuelto), en vez de reescribir todos los
    perfiles en cada guardado. El único caso que sigue sincronizando todo
    es el seed inicial cuando Supabase está vacío.
  - Se revisaron TODAS las escrituras a Supabase del repo: la mayoría
    (`db.service.js` para movimientos/movimientos_v2, `personal.service.js`,
    `tenant-request.service.js`, `profesional.service.js`) ya chequeaban
    `{ error }` correctamente. Se agregó el chequeo donde faltaba:
    `eliminarCliente`, `setPermisos` y el backfill de `tenant_id` en
    `ensureProfile`.
  - `db.service.js` tiene una función `upsertProfile` sin usar en ningún
    lado (confirmado por grep) — también le falta `tenant_id`, pero al no
    tener callers no representa un riesgo activo. Queda pendiente decidir
    si se borra.
  - `modoFullIA` sigue sin persistir en Supabase (la columna no existe) —
    migración propuesta en `sql/migrations/009_modo_full_ia.sql`, sin
    correr todavía. Falta además actualizar `buildProfileRow`/`cargarClientes`
    para escribirla y leerla una vez aplicada.

### Pendiente — formalmente anotado, no implementado todavía

1. **Acortar la duración de sesión del JWT (hoy 180 días) + refresh token en
   cookie httpOnly.** Decisión tomada: esto queda como mejora pendiente, no
   como "decisión de mantenerlo así". El sliding-refresh que ya existe
   (`SESSION_REFRESH_THRESHOLD_SEC`) cubre la UX de no pedir re-login
   seguido — lo que falta es que la ventana de validez de un token robado/
   filtrado sea mucho menor a 180 días. Diseño ya discutido: bajar
   `SESSION_DURATION` a algo como 7-14 días, evaluar mover el token a una
   cookie httpOnly+Secure en vez de `localStorage` cuando se aborde junto
   con multi-tenant (mismo momento que tiene sentido revisar todo el modelo
   de auth).
2. **RLS real por tenant** (ver sección 3, Fase 2) — hoy el aislamiento es
   solo de aplicación.
3. **`ALLOWED_EMAILS` fuera del `.env`** (ver sección 3, Fase 1).
4. **Revisión de cumplimiento legal (Ley 25.326 de Protección de Datos
   Personales)** antes de onboardear el primer cliente externo pago. Todavía
   no se evaluó formalmente — es un bloqueante de negocio/legal, no de
   código, pero hay que tenerlo en la lista antes de facturarle a un tercero
   (términos de servicio, dónde se alojan los datos, qué pasa si un tenant
   se da de baja, etc.).

### Checklist antes de cualquier cambio que toque auth o datos sensibles

- ¿Se sigue usando `service_role` en algún punto donde debería respetarse
  RLS? Si la respuesta es sí y es nuevo código, pensarlo dos veces.
- ¿El cambio asume `userId` de Telegram como identidad única, o ya
  contempla `tenant_id`?
- ¿Hay algún secreto (token, código, contraseña) que pueda terminar en un
  log? Usar `src/lib/logger.js`, nunca `console.log` directo en rutas de auth.
- ¿El cambio agrega un endpoint nuevo sin rate limiting donde correspondería
  tenerlo (ej. cualquier cosa que dependa de adivinar un código/token)?

---

## 5. Modelo de datos: v1 actual y plan de v2

El detalle completo (campos, categorías, reglas funcionales, sprints
recomendados) vive en `ROADMAP_CASHY_CLINICA.md` sección 4 — no se duplica
acá. Dos decisiones de arquitectura que sí van en este documento porque
condicionan cómo se implementa, no qué se implementa:

- **Migración de datos viejos: conviven, no hay migración masiva.** Cuando
  se active el modelo v2, los movimientos viejos quedan con campos
  `categoria`/`paciente_nombre`/etc. en `null` o `legacy`. Los reportes
  nuevos tienen que tolerar eso explícitamente. No se va a correr un script
  de reprocesamiento histórico — los movimientos nuevos usan v2 desde el día
  que se activa, los viejos quedan como están.
- **Google Sheets se mantiene para siempre como respaldo/vista editable.**
  Supabase es la fuente de verdad cuando está activo, pero el dual-write a
  Sheets no se retira — el cliente puede querer seguir viendo/editando ahí.
  Esto significa que el modelo v2 tiene que poder expresarse razonablemente
  bien en columnas de Sheet (aunque sea con algunas columnas nuevas), no
  diseñarse asumiendo que Sheets desaparece.

---

## 6. Infraestructura y flujo de deploy

### Hosting

**Railway, por ahora — con un criterio claro para reconsiderar**, no como
apuesta incondicional a largo plazo. Revisar la decisión cuando se cumpla
cualquiera de estos:
- Más de ~10 tenants activos simultáneos (volumen de writes a Sheets podría
  empezar a chocar con rate limits de la API de Google si todos comparten
  el mismo proceso/IP).
- El costo mensual de Railway supera un umbral que ya no se sienta
  "barato" comparado a alternativas (definir el número cuando se llegue).
- Se necesite escalar horizontalmente de una forma que Railway no maneje
  bien out-of-the-box (más de una réplica con estado compartido en memoria,
  como el `write-queue` o las TTLMaps de `state/index.js` — hoy asumen un
  solo proceso).

### Escalabilidad y resiliencia bajo carga

**Hecho (2026-06-24) — optimizaciones que NO requieren cambiar de hosting ni
infra nueva.** Llevan el techo de "un solo proceso" bastante más arriba
(decenas de tenants) sin tocar la arquitectura:

- **Logs**: se sacaron los `console.log('[debug]'…)` que imprimían movimientos
  completos (PII) en cada insert.
- **Crash recovery**: `uncaughtException` ahora loguea, cierra ordenado y hace
  `process.exit(1)` para que Railway levante una instancia limpia (antes seguía
  con estado indefinido).
- **Rate limit en `/api`**: límite global por IP (120/min) sobre las rutas de
  datos (excluye `/api/auth/*`, `/api/events` SSE y `/api/cotizacion`). Protege
  la cuota de Google Sheets de un dashboard con refresh agresivo o de abuso.
- **Menos llamadas a Sheets por operación**: `getSheetCliente` reusa el
  documento cacheado (TTL 2h) en vez de rehacer `loadInfo()`, y se quitó
  `loadCells()` (cargaba toda la grilla) de los caminos de lectura y escritura.
- **Dual-write a Sheets best-effort**: con Supabase como fuente de verdad, la
  copia a Google Sheets se hace en background bajo el lock del usuario
  (`runInBackground` en `src/lib/write-queue.js`), sin demorar la respuesta del
  bot/dashboard. Si Sheets está lento o sobre cuota, no afecta al usuario.
- **Lecturas acotadas**: `fetchLegacyRowsForUser` trae como mucho
  `MAX_MOVIMIENTOS_READ` (20k) filas más recientes en vez de toda la historia,
  con índice `idx_movimientos_tenant_user_created`
  (`sql/migrations/004_indexes.sql`). Es un guard contra lecturas desbocadas,
  no paginación real — cuando un tenant se acerque a ese número, toca paginar.
- **Concurrencia de Gemini acotada**: semáforo compartido (`src/lib/semaphore.js`,
  máx 3 en vuelo, cola de 12) para fotos de agenda + transcripción de audio, así
  N usuarios mandando media a la vez no disparan N llamadas simultáneas a Gemini.

**Pendiente — escalado horizontal real (Fase 2, NO implementado).** El único
bloqueante que **corrompe datos** al correr 2+ instancias es el write-lock en
memoria (`withUserWriteLock` en `src/lib/write-queue.js`): dos instancias
escribiendo el mismo Sheet/fila a la vez. El resto del estado en memoria
(rate limiters, `_movCache` de `api/index.js`, suscriptores SSE de
`events.service.js`, TTLMaps de `state/index.js`) es degradable-pero-tolerable
por instancia un tiempo. Para escalar a réplicas hace falta:

1. **Prerrequisito (acción manual)**: provisionar **Redis** en Railway
   (add-on) y exponer `REDIS_URL` como variable de entorno. Agregar dependencia
   `ioredis`.
2. **Write-lock distribuido en Redis**: reemplazar la implementación de
   `withUserWriteLock` por un lock en Redis (`SET key NX PX ttl` con release
   seguro, o `redlock`), keyed por userId, manteniendo la misma interfaz para
   no tocar los callers. Conviene un fallback automático a la versión en memoria
   cuando `REDIS_URL` no está, para poder shipear el código dormido.
3. **`auth_codes`**: ya se persisten en Supabase (`api/index.js`); quitar la
   dependencia del `Map` global en memoria como fuente.
4. **SSE entre instancias**: o Redis pub/sub para fan-out de
   `movimientos_updated`, o activar **sticky sessions** en Railway y mantener
   SSE por-instancia.
5. **Activar réplicas**: recién subir a 2+ instancias en Railway cuando 2–4
   estén listos **y** las optimizaciones de arriba lleven un tiempo estables en
   producción. No antes.

Mientras tanto, el sistema corre como **una sola instancia** (no subir el
replica count en Railway hasta hacer la Fase 2).

### CI/CD

**Hoy**: push directo a `main`, Railway redeploya automático, CI corre pero
no bloquea nada (solo notifica a Discord).

**Decisión tomada**: mantener push directo mientras seas el único
desarrollador — la velocidad importa más que el proceso en esta etapa. Pero
**planificar el cambio a PRs + CI bloqueante**, no dejarlo solo como nota
para "algún día". Disparadores concretos para hacer el cambio:
- Se suma otro desarrollador al proyecto (no compartir el hábito de pushear
  directo entre dos personas — ahí sí hace falta el gate).
- Se onboardea el primer cliente externo pago (en ese momento un bug en
  producción ya no es solo "tu" problema).

Cuando llegue ese momento, el cambio es chico: activar "branch protection"
en GitHub requiriendo que el check de CI esté en verde antes de mergear a
`main`, y pasar a trabajar con Pull Requests. El workflow de CI ya está listo
para soportar esto sin cambios (ya corre en `pull_request` además de `push`).

---

## 7. Cómo usar este documento al retomar el roadmap

1. Antes de empezar cualquier ítem de `ROADMAP_CASHY_CLINICA.md`, releer la
   sección 3 (multi-tenancy) y 4 (seguridad) de este archivo.
2. Si el ítem del roadmap choca con algo de las fases de la sección 3 (por
   ejemplo, una feature que solo tiene sentido si hay un tenant real),
   evaluar si conviene adelantar la fase correspondiente o diseñar la
   feature para que no haga supuestos que después haya que deshacer.
3. Si se toma una decisión de arquitectura nueva que no estaba anotada acá,
   agregarla a la tabla de la sección 8 antes de cerrar la conversación
   donde se decidió — el objetivo es no volver a discutir lo mismo dos veces
   por no haberlo dejado escrito.

---

## 8. Registro de decisiones (ADR corto)

| Fecha | Decisión | Por qué |
|---|---|---|
| 2026-06-19 | Documento de arquitectura separado de `CLAUDE.md` | `CLAUDE.md` debe quedar corto; el detalle técnico/seguridad vive acá |
| 2026-06-19 | Alcance real es multi-tenant SaaS, no un bot a medida | Intención de negocio confirmada: vender a otros consultorios |
| 2026-06-19 | Google Sheets se mantiene para siempre como respaldo | El cliente puede querer seguir viendo/editando ahí, no es solo transicional |
| 2026-06-19 | JWT de 180 días queda como mejora de seguridad pendiente, no como decisión final | Es un riesgo real para sesiones robadas/filtradas; falta implementarlo, no está descartado |
| 2026-06-19 | Self-service con aprobación manual (no registro abierto) | Mientras sean pocos clientes, mantener control de quién entra |
| 2026-06-19 | Migración a modelo v2 sin reprocesar histórico (convive con legacy) | Menor riesgo/esfuerzo que una migración masiva; el roadmap ya lo sugería |
| 2026-06-19 | Railway como hosting actual, no decisión permanente | Revisar si crece la cantidad de tenants o el costo deja de ser conveniente |
| 2026-06-19 | Mantener push directo a `main`, planificar PRs + CI bloqueante a futuro | Velocidad de iteración hoy > proceso, pero hay disparadores claros para cambiarlo |
| 2026-06-24 | Optimizaciones de carga sin infra nueva (rate limit, dual-write async, lecturas acotadas, semáforo Gemini) antes de escalar horizontal | Suben el techo de un solo proceso a decenas de tenants con bajo riesgo; el escalado horizontal (Redis) recién vale la pena después |
| 2026-06-24 | Escalado horizontal (Fase 2) requiere Redis y se mantiene en **una sola instancia** hasta implementarlo | El write-lock en memoria corrompe datos con 2+ instancias; ver sección 6, "Escalabilidad y resiliencia" |
| 2026-07-13 | Permisos granulares por usuario (6 permisos, presets de conveniencia) en vez de roles fijos | Permite que el dueño configure exactamente qué ve cada persona (odontólogos, recepcionista, contadora) sin roles rígidos |
| 2026-07-13 | Permisos resueltos server-side en cada request, no horneados en el JWT | Los tokens duran 180d; un cambio de permisos debe impactar al toque sin re-login |
| 2026-07-13 | `ver_movimientos` y `ver_balance` son permisos separados | La recepcionista carga cobros (ver_movimientos + cargar_movimientos) pero no ve el balance/reportes (ver_balance) |
| 2026-07-13 | `/cobrado` en agenda requiere `cargar_movimientos`, no `editar_agenda` | Cobrar un turno crea un movimiento de plata; un odontólogo con solo agenda no debe poder cobrar |
| 2026-07-13 | Default de permisos = `['ver_agenda']` (mínimo, fail-safe) | Un usuario nuevo nunca ve ni toca plata por accidente |
| 2026-07-13 | Dueño/admin siempre tiene ADMIN_PERMISOS implícitos, no se persisten | No hay forma de auto-bloquearse como dueño ni de perder el acceso por un bug de escritura |
| 2026-09-23 | Permisos granulares extendidos al bot de Telegram (`src/auth/bot-permisos.js`), cubriendo comandos, texto libre/voz e intents NLP | Revisión de seguridad detectó que solo la API del dashboard aplicaba `resolverPermisos`; en el bot cualquier invitado con cualquier permiso podía usar comandos de plata/agenda sin restricción |
| 2026-09-23 | Finanzas personales (`/personal`, `/viaje`, `/api/personal/*`, botón "Es personal" del NLP, sección Personal del dashboard) restringidas a dueño/admin | `getSheetId` resuelve al invitado al sheet del dueño, así que sin este cambio cualquier invitado podía leer, cargar y borrar los movimientos personales, presupuestos y viajes del dueño — no hay (ni está previsto) un ámbito personal por invitado |
| 2026-09-23 | `DASHBOARD_DEV_TOKEN` restringido a `NODE_ENV=development`, comparación en tiempo constante | Revisión de seguridad: sin entorno ni comparación segura, cualquiera que conociera el valor entraba como cualquier usuario (incluido el admin) en cualquier entorno, con una comparación `===` filtrable por timing |
| 2026-09-23 | Código de acceso al dashboard baja a 10 minutos de validez y se invalida a los 5 intentos fallidos (reusa `MAX_INTENTOS_CODIGO`) | Revisión de seguridad: 24h de vigencia y sin límite de intentos hacía viable fuerza bruta sobre un código de 6 dígitos |
| 2026-09-23 | Modo Full IA (`/api/config/modo-ia`, `/modoia`) restringido a dueño/admin | Revisión de seguridad: cualquier invitado podía activarlo/desactivarlo para todo el consultorio, generando costo real en OpenRouter |
| 2026-09-23 | El invitado usa el sheet del dueño (sin uno propio); `obtenerClientePorUserId` resuelve por `ownerId` explícito, no por orden de iteración de IDs | Revisión de seguridad: el resultado dependía de si el ID de Telegram del invitado era mayor o menor al del dueño — con cierto orden, el invitado terminaba como dueño de su propio sheet con permisos completos, ignorando lo configurado en /accesos. Decisión de producto confirmada con el usuario: sheet compartido con permisos granulares, no sheet propio aislado |
| 2026-09-23 | `buildProfileRow` incluye `tenant_id` (vía nuevo `tenant-provisioning.service.js`); `guardarClientes` sube solo el perfil que cambió, no todos | Revisión de seguridad: `profiles.tenant_id` es NOT NULL desde la migración 003, pero el insert de un perfil nuevo nunca lo mandaba — fallaba en silencio (supabase-js devuelve `{ error }`, no lo lanza, y no se chequeaba) y el usuario quedaba sin fila en Supabase, con riesgo real de perder el alta en el próximo deploy de Railway |
