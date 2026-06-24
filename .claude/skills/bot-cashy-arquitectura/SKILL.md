---
name: bot-cashy-arquitectura
description: >-
  Bootstrap, registro de handlers/comandos, routing de callbacks, estados
  conversacionales (TTLMaps), y las salvaguardas de resiliencia/escalabilidad
  (rate limit, write-lock, semáforo, manejo de uncaughtException) de bot_cashy.
  Usar cuando se trabaje en src/index.js, src/handlers/ (incluyendo commands/),
  src/state/index.js, src/auth/index.js, src/lib/write-queue.js,
  src/lib/semaphore.js, o para entender qué comando/handler dispara qué código.
---

# bot_cashy — Arquitectura general y routing

## Bootstrap (`src/index.js`)

Orden de carga (importa con efectos secundarios — cada `require` registra
handlers en `bot` de Telegraf vía `src/lib/telegraf.js`):

1. `require('./handlers/middleware')` — auth, rate limiting, logging.
2. ~30 comandos en `src/handlers/commands/*.js` (uno por archivo, ver tabla).
3. `require('./handlers/text')` — handler de texto libre (NLP, ver skill
   `bot-cashy-nlp`).
4. `require('./handlers/photo')` y `require('./handlers/voice')` — fotos de
   agenda (Gemini Vision) y notas de voz (transcripción Gemini), ambas
   limitadas por `geminiMediaSemaphore` (ver skill `bot-cashy-nlp`).
5. `require('./handlers/actions')` y `require('./handlers/nlp-confirm')` —
   callbacks de botones inline.
6. `startApi()` — levanta la API del dashboard (Express), **independiente** del
   bot (no bloquea ni depende de `bot.launch()`). El server se guarda en
   `apiServer` para cerrarlo ordenado en el shutdown.
7. `bot.launch()` → luego `initModel()` (Gemini) y
   `obtenerCotizacionDolar()` (inicial + cada 3h, timer `unref()`d para no
   bloquear el shutdown).
8. **Manejo de fallos del proceso**: `SIGINT`/`SIGTERM` → `bot.stop()`.
   `unhandledRejection` → log. `uncaughtException` → log + cierre ordenado
   (`bot.stop()` + `apiServer.close()`) + `process.exit(1)` con guard
   anti-reentrada, para que Railway levante una instancia limpia (tras un
   uncaught el proceso queda en estado indefinido).

## Comandos (`src/handlers/commands/`)

| Archivo | Comando(s) | Función |
|---|---|---|
| `start.js` | `/start` | Bienvenida, registro de nuevo usuario / invitación |
| `ayuda.js`, `help.js` | `/ayuda`, `/help` | Listado de comandos |
| `balance.js` | `/balance` | Resumen hoy/semana/mes |
| `hoy.js` | `/hoy` | Movimientos del día |
| `semana.js` | `/semana` | Resumen semanal |
| `mes.js` | `/mes` | Balance del mes |
| `ingresos.js` | `/ingresos` | Lista de ingresos |
| `egresos.js` | `/egresos` | Lista de egresos |
| `pendientes.js` | `/pendientes` | Movimientos sin cobrar |
| `cobrar.js` | `/cobrar ultimo`, `/cobrar [nombre]` | Marcar como cobrado |
| `pendiente.js` | `/pendiente` | Registrar movimiento pendiente |
| `ingreso_paciente.js` | `/ingreso_paciente` | Wizard paso a paso (usa `state.pendingIngresoPacientes`) |
| `eliminar.js` | `/eliminar` | Borrar movimiento (confirmación, `pendingDeletes`) |
| `editar.js` | `/editar` | Editar movimiento (`pendingEdits`) |
| `listar.js` | `/listar` | Listado completo de movimientos |
| `debug.js` | `/debug` | Info de diagnóstico (admin) |
| `limpiar.js` | `/limpiar` | Limpieza de datos (`pendingLimpiezas`) |
| `dolar.js` | `/dolar` | Cotización actual |
| `actualizardolar.js` | `/actualizardolar` | Forzar actualización cotización |
| `cancelar.js` | `/cancelar` | Cancela cualquier flujo pendiente |
| `codigo.js` | `/codigo` | Generar código de invitación (owner) |
| `unir.js` | `/unir` | Unirse con código de invitación |
| `misusuarios.js` | `/misusuarios` | Listar usuarios invitados (owner) |
| `reiniciar.js` | `/reiniciar` | Reset de cuenta (confirmación, `pendingReinicios`) |
| `regenerar_ids.js` | `/regenerar_ids` | Regenerar `ID_Unico` de filas viejas |
| `palabras.js` | `/palabras` | Ayuda de lenguaje natural soportado |
| `sheet.js` | `/sheet` | Link al Google Sheet del usuario |
| `salir.js` | `/salir` | Salir de una cuenta compartida |
| `nlptest.js` | `/nlptest` | Testear el parser NLP sin registrar nada |
| `profesional.js` | `/profesional` | Gestión de profesionales (sql `profesionales`) |

## Handlers especiales

- `handlers/middleware.js` — corre antes que todo: valida usuario
  autorizado/registrado (`auth/index.js`), aplica rate limiting
  (`state.userRateLimits`, `RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX_EVENTS`).
- `handlers/text.js` — todo mensaje de texto que no es comando (`/...`).
  Ver skill `bot-cashy-nlp` para el detalle del parsing.
- `handlers/photo.js` — fotos de agenda → Gemini Vision
  (`GEMINI_VISION_MODEL`) → extrae turnos → confirmación
  (`pendingAgendaConfirm`). La llamada a Gemini va dentro de
  `geminiMediaSemaphore.run(...)`.
- `handlers/voice.js` — notas de voz → transcripción con Gemini (también bajo
  el semáforo) → se re-procesa el texto con `procesarTextoConNlp`.
- `handlers/actions.js` — callbacks genéricos de botones inline
  (`confirmButtons`, `discardButtons`, confirmar/cancelar ediciones,
  borrados, reinicios, etc.).
- `handlers/nlp.js` / `handlers/nlp-confirm.js` — dispatch y confirmación de
  intents NLP (ver skill `bot-cashy-nlp`).

## Estados conversacionales (`src/state/index.js`)

Todos son `TTLMap` (Map con expiración automática vía `setTimeout.unref()`).
TTL default 30 min salvo donde se indica:

- `pendingRegistros` — flujo de registro (`/start`, alta de sheet).
- `pendingCodigos` — códigos de invitación activos.
- `pendingNlpMovimientos` (TTL 5 min) — movimiento NLP esperando confirmación.
- `pendingPayments` — esperando método de pago.
- `pendingIntentosEmail` / `pendingIntentosCodigo` — contadores de intentos
  fallidos (rate limiting de auth, `MAX_INTENTOS_EMAIL=3`,
  `MAX_INTENTOS_CODIGO=5`).
- `pendingDeletes`, `pendingEdits`, `pendingLimpiezas`, `pendingReinicios` —
  confirmaciones de operaciones destructivas/edición.
- `pendingCotizaciones` — esperando que el usuario confirme/ingrese
  cotización del dólar para un movimiento en USD.
- `pendingDescripcion` — esperando descripción faltante de un movimiento.
- `pendingAgendaConfirm` — confirmación de turnos extraídos de una foto.
- `pendingIngresoPacientes` — wizard de `/ingreso_paciente`.
- `docsCache` (TTL 2h) — cache de documentos de Google Sheets por usuario.
- `userRateLimits` (Map simple) — rate limiting general.
- `processingNlp` (Set) — evita procesar 2 mensajes NLP del mismo usuario en
  paralelo.

## Autenticación / multiusuario (`src/auth/index.js`)

- `obtenerClientePorUserId(userId)` — recorre `clienteService.clientes`
  (mapa ownerId → {sheetId, email, usuarios[]}); un usuario puede ser
  `isOwner: true` (dueño de la cuenta/sheet) o estar en `usuarios[]` de otro
  owner (invitado).
- `esAdminOriginal(userId)` — compara contra `AUTHORIZED_USER_ID` (admin
  original, usa `SPREADSHEET_ID` del `.env` directo, sin pasar por
  `clientes.json`).
- Flujo de invitación: owner genera código (`/codigo` →
  `invite.service.createInviteCode`) → invitado usa `/unir <codigo>` o se
  registra con código durante `/start` → `resolveInviteCode` valida
  (con límite de intentos `MAX_INTENTOS_CODIGO`) → se agrega a
  `usuarios[]` del owner.

## Persistencia de clientes (`src/services/cliente.service.js`)

- `clientes.json` (gitignored) es la fuente local; si `USE_SUPABASE=true`,
  se sincroniza con la tabla `profiles` (best-effort, el archivo local
  siempre se escribe primero como backup).
- Todas las escrituras (`guardarClientes`, `eliminarCliente`) pasan por una
  cola (`encolarEscritura`) para serializar accesos concurrentes y evitar
  que dos registros simultáneos pisen el archivo.

## Multi-tenancy (Fase 2)

Cada consultorio es un **tenant** (`tenant_id`). Toda query a tablas de negocio
(`movimientos`, `profesionales`) pasa obligatoriamente por
`forTenant(tenantId)` de `src/lib/tenant-db.js`; el CI lo verifica
(`npm run check:tenant`). El detalle de datos vive en el skill `bot-cashy-db`
y en `ARCHITECTURE.md` sección 3. Hoy el sistema corre como **una sola
instancia** (el escalado horizontal real necesita Redis para el write-lock —
ver `ARCHITECTURE.md` sección 6).

## Resiliencia y escalabilidad (carga)

Optimizaciones para aguantar muchos usuarios/peticiones sin caerse (detalle en
`ARCHITECTURE.md` sección 6, "Escalabilidad y resiliencia"):

- **Rate limit del bot**: `handlers/middleware.js` (`state.userRateLimits`).
- **Rate limit de la API**: middleware global por IP en `/api` de datos
  (`src/api/index.js`, `createLimiter` de `src/lib/rate-limiter.js`, 120/min),
  excluye `/api/auth/*`, `/api/events` (SSE) y `/api/cotizacion`. Guard:
  `tests/api.rate-limit.test.js`.
- **Write-lock por usuario**: `withUserWriteLock(userId, fn)`
  (`src/lib/write-queue.js`) serializa escrituras del mismo usuario (cobros,
  ediciones, addRow). `runInBackground(userId, fn)` corre trabajo best-effort
  bajo el lock sin bloquear al caller (dual-write a Sheets, sync de Agenda).
- **Semáforo de Gemini**: `geminiMediaSemaphore` (`src/lib/semaphore.js`, máx
  3) acota la concurrencia de foto/voz.
- **Lecturas acotadas**: `MAX_MOVIMIENTOS_READ` en `db.service.js`.
- **Cache de doc de Sheets**: `docsCache` (TTL 2h) en `state`, reusado por
  `getSheetCliente` (no rehace `loadInfo()`/`loadCells()` en cada llamada).

> Casi todo el estado vive en memoria de un solo proceso (TTLMaps, locks,
> caches, suscriptores SSE de `events.service.js`). Por eso NO se puede subir
> el replica count en Railway hasta hacer la Fase 2 de escalado (Redis).

## Dónde mirar el código fuente

- `src/index.js` — orden de bootstrap.
- `src/api/index.js` — API del dashboard (auth JWT, rate limit, SSE, rutas).
- `src/lib/write-queue.js`, `src/lib/semaphore.js` — locks y concurrencia.
- `src/handlers/middleware.js`, `src/handlers/actions.js` — cross-cutting.
- `src/auth/index.js`, `src/services/invite.service.js`,
  `src/services/cliente.service.js` — auth/multiusuario.
- `src/state/index.js` — todos los TTLMaps y su uso.
