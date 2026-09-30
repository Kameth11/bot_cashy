# Auditoría de escalabilidad, arquitectura y seguridad — 2026-09-30

> Hallazgos pendientes. Cuando se cierre uno, tildarlo acá y, si fue una
> decisión de fondo, sumarlo al ADR de `ARCHITECTURE.md` sección 8.
> Contexto general y plan multi-tenant: `ARCHITECTURE.md`.

**Alcance:** revisión de código sobre `main` (commit `5d0254c`), sin cambios de
código. Estado al momento: 648/648 tests verdes, `check:tenant` OK.
**Veredicto:** apto para 1–3 consultorios en una instancia. Los ítems 1–4 hay
que cerrarlos antes de venderle a un tercero.

Leyenda de confianza: **[V]** verificado (corrida o lectura directa),
**[?]** hay que confirmarlo fuera del repo (config de Supabase/Google/Railway).

---

## Crítico / alto

- [x] **1. Rate limiters compartidos entre todos los usuarios** **[V]**
  `src/api/index.js` limita por `req.ip` y nunca hace `app.set('trust proxy', …)`.
  Probado localmente: con `X-Forwarded-For: 203.0.113.9`, `req.ip` sigue siendo
  `127.0.0.1`. Detrás de Railway todos comparten la IP del proxy, así que el
  límite de 120 req/min es global, y los de `/api/auth/request-code` (20/10 min)
  y `/api/auth/verify` (30/10 min) también. Además `requestCodeByUser` (5/10 min
  por Telegram ID, sin autenticar) permite bloquear el login de otra persona.
  **Resuelto (2026-09-30):** `app.set('trust proxy', TRUST_PROXY_HOPS ?? 1)` +
  `tests/api.trust-proxy.test.js` (falla sin el fix). Pendiente **[?]**: confirmar
  que Railway agrega exactamente 1 salto; si no, setear `TRUST_PROXY_HOPS`.

- [~] **2. Lecturas de historial completo; el tope de 20.000 puede ser 1.000** **[V]/[?]**
  `fetchLegacyRowsForUser` usa `.limit(20000)`, pero el `max-rows` por defecto de
  PostgREST en Supabase es 1000 y gana sobre `.limit()`. Si no se subió,
  balances y dashboard se truncan en silencio **[?]** (Supabase → Settings → API
  → Max rows).
  Aunque el tope sea real: `updateMovimiento`/`deleteMovimiento`/`findRowByIdUnico`
  cargan todas las filas y buscan en memoria; `/api/movimientos` no pagina;
  balances y `/hoy`/`/semana` se calculan en memoria sobre todo el historial.
  *Arreglo:* consultas `.eq('id_unico', …)`, filtros por rango de fechas y
  agregados en SQL, paginación.
  **Parcial (2026-09-30):** (a) `fetchLegacyRowsForUser` ahora pagina con
  `.range()` de a 1000 (hasta `MAX_MOVIMIENTOS_READ`), así que ya no se trunca
  en silencio con `max-rows`=1000; (b) editar/borrar busca por `id_unico` en la
  DB (`buscarFilaSupabasePorIdUnico`) en vez de cargar todo. Tests:
  `db.service.boundedRead`, `db.service.findById`.
  (c) `obtenerDatosSheet` (path Supabase) tiene cache de 15 s con single-flight,
  keyeado por dueño e invalidado en cada escritura: comandos del bot, dashboard
  y `/api/profesionales` (antes sin cache) dejan de releer todo el historial en
  cada llamada. Test: `db.service.datosCache`.
  **Falta:** el cálculo de balances/`/hoy`/`/semana` sigue siendo en memoria
  sobre el historial completo (una lectura cada 15 s como mucho); los filtros
  `desde/hasta/estado` de `/api/movimientos` se aplican en memoria, no en SQL;
  no hay paginación hacia el dashboard; `findRowByCompositeKey` sigue
  escaneando todo. Empujar esos filtros a SQL requiere cuidar el mapeo de
  estado/fecha legacy↔DB y las filas v2: hacerlo cuando un tenant se acerque a
  ~5.000 movimientos, no antes.
  Si el `max-rows` del proyecto fuera < 1000 el paginado corta antes: mantener
  `MOVIMIENTOS_PAGE_SIZE` <= `max-rows`.

- [~] **3. Google Sheets como cuello de botella** **[V]/[?]**
  Cuota de Google ≈ 60 req/min por usuario y por proyecto, y todos los tenants
  usan la misma service account **[?]**. Cada escritura cuesta 2–3 llamadas
  (`ensureSheetStructure` hace `loadHeaderRow` en cada `addRow`, más el `addRow`
  y el color). Sin retry/backoff ante 429 en ningún servicio (solo Gemini lo
  maneja). El dual-write en background falla solo con `console.error`: el
  respaldo puede divergir sin aviso. Agenda/personal/comprobantes leen la
  pestaña entera con `getRows()` sin cache (Turnos crece sin límite). Con
  `USE_SUPABASE=false` Sheets es la ruta primaria y el techo baja mucho.
  *Arreglo:* backoff con reintentos, cola/reconciliación del respaldo, no
  llamar `ensureSheetStructure` en cada escritura, cachear/acotar lecturas.
  **Parcial (2026-09-30):**
  (a) `src/lib/google.js` → `crearDocumento()` instala reintentos con backoff +
  jitter y `Retry-After` sobre la Sheets API (429/503 en cualquier método; otros
  5xx y errores de red solo en GET, para no duplicar filas). Único punto de
  creación de `GoogleSpreadsheet`. Test: `lib.google-retry`.
  (b) Llamadas por escritura: de ~6 a 2 (color en un solo `batchUpdate` en vez
  de uno por columna; no se releen encabezados; `ensureSheetStructure` cachea 10
  min por pestaña). Test: `sheet.service.ensureStructure`.
  **Falta:** cola persistente/reconciliación del respaldo (si tras 4 reintentos
  falla, sigue siendo solo `console.error`); cache/acotado de `getRows()` en
  agenda, personal y comprobantes; confirmar la cuota real en la consola de
  Google Cloud **[?]**.

- [~] **4. Ciclo de vida del proceso e instancia única** **[V]**
  - Sin apagado ordenado: en SIGTERM solo `bot.stop`. No se cierra el servidor
    HTTP ni se vacía la cola de `runInBackground` → un deploy puede perder
    escrituras de respaldo a Sheets en vuelo.
  - Deploy con solapamiento → `409 Conflict` de Telegram (polling doble).
  - Códigos de login primero en `global._authCodes` (memoria), después Supabase:
    con 2 réplicas verifican distinto.
  - No hay `/health` ni healthcheck en `railway.json`.
  - Con `USE_SUPABASE=false`, `clientes.json` se pierde en cada deploy.
  - (Ya documentado en `ARCHITECTURE.md` §6: write-lock en memoria, Redis.)
  **Parcial (2026-09-30):**
  (a) Apagado ordenado en SIGTERM/SIGINT (`src/index.js`): para el bot, cierra el
  server, espera hasta 10 s a que se vacíen las escrituras (`esperarPendientes`
  en `write-queue.js`, incluye el dual-write a Sheets) y sale. Probado con un
  SIGTERM real.
  (b) `GET /health` (sin auth ni rate limit) + `healthcheckPath` en
  `railway.json` (timeout 300 s por el build en `start:prod`).
  (c) Códigos de login: Supabase (`auth_codes`) es la fuente de verdad; el Map en
  memoria queda de respaldo y se purga al pedir códigos. Verifican entre
  instancias y tras un redeploy. Tests: `api.health`, `api.auth-codes-supabase`,
  `lib.write-queue`.
  **Falta / a confirmar:** (1) `start:prod` corre `npm run build && node ...`: si
  npm no reenvía SIGTERM a node el apagado ordenado no corre en Railway
  **[?]** — mirar el log del deploy buscando "apagado ordenado"; conviene sacar
  el build del arranque. (2) El `409` de Telegram por polling doble en deploys
  con solapamiento sigue posible. (3) `clientes.json` se pierde en cada deploy
  con `USE_SUPABASE=false`. (4) Escalar a >1 réplica sigue requiriendo Redis.

## Medio

- [x] **5. `PUT /api/movimientos/:id` sin validar** **[V]**
  `descripcion` no pasa por `sanitizarInput` (sin tope de largo ni prefijo `'`
  anti-fórmula, que el POST sí aplica); `monto` acepta `NaN`; **no se recalcula
  `MontoPesos`** al cambiar monto o moneda → balances inconsistentes tras editar.

- [x] **6. Registro de sheet sin verificar dueño** **[V, por lectura]**
  `handleSheetIdStep` (`registration.service.js`) no chequea que el `sheetId` no
  pertenezca ya a otro dueño, y `resolveOrCreateTenantId` agrupa por `sheet_id`:
  registrar el ID de otro consultorio deja al usuario dentro de ese tenant. Lo
  mitiga la aprobación manual y la dificultad de adivinar el ID. Cerrar antes de
  self-service. No se explotó, solo se leyó el flujo.
  **Resuelto (2026-09-30):** `clienteService.sheetIdEnUsoPorOtro` + chequeo en
  `handleSheetIdStep` (también rechaza el sheet del admin), antes de tocar Google.
  Tests: `cliente.service.sheetIdEnUso`, `registration.sheetIdEnUso`.
  **Hallazgo relacionado (nuevo, grave, resuelto):** `ensureProfile` crea una fila
  en `profiles` para el invitado con el `sheet_id` del dueño; al recargar desde
  Supabase volvía como registro propio sin `ownerId`, y un invitado con ID
  numérico **menor** al del dueño resolvía como **dueño con todos los permisos**
  (reproducido con la función real). `obtenerClientePorUserId` ahora lo trata
  como invitado si otro dueño lo lista en `usuarios[]` y comparten sheet (o no
  tiene sheet propio). Test: `auth.guestShadowProfile`. Pendiente: que
  `ensureProfile` no cree esas filas sombra y revisar si hay invitados afectados
  en producción (perfiles con `sheet_id` igual al de su dueño).

- [x] **7. Puntos ciegos del guard de aislamiento** **[V]**
  `scripts/check-tenant-isolation.js` busca `getSupabase().from(...)`; las
  consultas a `movimientos_v2` usan `supabase.from(...)` con variable y no las
  detecta. Además se filtran por `user_id`, no `tenant_id`. Hoy esas tablas no
  existen en producción; tratarlo cuando se activen v2.
  **Corrección + resuelto (2026-09-30):** la descripción original era imprecisa:
  para las tablas de `SCOPED_TABLES` el guard sí detectaba `supabase.from('x')`
  (la regex no depende de cómo se obtuvo el cliente). El hueco real era que solo
  miraba esas tablas: una tabla nueva de negocio, las de v2, un `.from(variable)`
  o un `.rpc()` pasaban sin aviso. Ahora es una **lista cerrada**: toda tabla
  tiene que estar en `SCOPED_TABLES` (vía `forTenant`), en `GLOBAL_TABLES`
  (`profiles`, `tenants`, `tenant_requests`, `auth_codes`) o en `DRAFT_TABLES`
  (v2, con aviso de sumarles `tenant_id` al activarlas); `.from(dinámico)` y
  `.rpc()` fallan salvo `tenant-isolation-ignore`. Test:
  `scripts.tenantIsolation`. Pendiente: `movimientos_v2` sigue filtrando por
  `user_id` y no por `tenant_id`, hacerlo al activar v2.

- [ ] **8. JWT de 180 días con renovación deslizante** **[V]**
  Sin revocación, en `localStorage`; en la práctica no vence mientras se use.
  Ya figura como pendiente en `ARCHITECTURE.md` §4.

- [ ] **9. Sin cuota de IA por tenant** **[V]**
  Solo hay 12 mensajes/10 s por usuario. Nada diario ni atribución de costo por
  tenant; cualquier invitado puede consumir Gemini/OpenRouter.

- [~] **10. Dependencias vulnerables** **[V, `npm audit` del 2026-09-30]**
  Raíz: 10 vulns (4 altas): `sharp`/libvips (procesa imágenes de usuarios),
  `ws`, `uuid`/`gaxios`. `npm audit fix` cubre la mayoría; `sharp` pide salto
  mayor (0.35.x). Dashboard: 4 (3 altas), todas en `react-router`.
  **Parcial (2026-09-30):** `npm audit fix` sin cambios mayores → raíz 10→5.
  Quedan `sharp` (salto mayor, probar con fotos reales), `@supabase/supabase-js`
  (fijado en 2.49.1) y `uuid`/`gaxios` (vía google-spreadsheet): requieren `--force`.

- [ ] **11. CI no bloquea el deploy** **[V]**
  Decisión documentada para un solo desarrollador; su disparador es "primer
  cliente externo pago".

## Bajo

- [ ] Maps que nunca se limpian: `userRateLimits`, `hits` de los limiters,
  `_authCodes`, `_movCache`.
- [ ] SSE sin tope de conexiones por usuario.
- [ ] `request-code` responde distinto (403/200) según exista el usuario →
  enumeración de IDs de Telegram.
- [ ] Carrera en la marca `used` de la verificación de código.
- [ ] Archivos muy grandes: `db.service` (1345), `command.service` (1257),
  `api/index.js` (1111, todas las rutas), `text.js` (1038), `quick_nlp` (1054).
- [ ] `@supabase/supabase-js` con anon key en el bundle del dashboard sin uso.

---

## Pendientes a cargo del dueño (preguntarle en cada sesión hasta que los confirme)
- [ ] Supabase → Settings → API → **Max rows**: confirmar que sea >= 1000 (ítem 2; con el paginado ya no trunca si es 1000)
- [ ] Railway: tras el próximo deploy, ¿el log muestra "SIGTERM recibido: apagado ordenado"? (ítem 4)
- [ ] Railway: ¿agrega exactamente 1 salto de proxy? Si no, setear `TRUST_PROXY_HOPS` (ítem 1)

## Orden sugerido
1. **Ya:** ítem 1 (`trust proxy`), verificar `max-rows` (2), ítem 5, `npm audit fix` (10).
2. **Antes del 2.º cliente:** consultas por id/rango (2), retry + reconciliación
   de Sheets (3), apagado ordenado + `/health` (4), unicidad de `sheetId` (6).
3. **Antes de cobrar:** CI bloqueante (11), cuota de IA (9), JWT corto con
   revocación (8); Redis/réplicas solo si hace falta.

## Por qué no aparecieron en la revisión del 2026-09-23/24
Ver `git log` de esas fechas y `ARCHITECTURE.md` §4 y §8: aquella revisión fue
de **autorización e integridad de datos** (quién ve/hace qué, invitados, tenant,
zona horaria, Markdown). Estos hallazgos son de **comportamiento en producción**
(proxy, cuotas externas, ciclo de vida) o de **caminos paralelos** que el
arreglo puntual no barrió (el `PUT` frente al `POST`). Los tests no los cubren
porque ejecutan el código sin proxy ni límites externos.
