---
name: bot-cashy-arquitectura
description: >-
  Bootstrap, registro de handlers/comandos, routing de callbacks y estados
  conversacionales (TTLMaps) de bot_cashy. Usar cuando se trabaje en
  src/index.js, src/handlers/ (incluyendo commands/), src/state/index.js,
  src/auth/index.js, o para entender qué comando/handler dispara qué código.
---

# bot_cashy — Arquitectura general y routing

## Bootstrap (`src/index.js`)

Orden de carga (importa con efectos secundarios — cada `require` registra
handlers en `bot` de Telegraf vía `src/lib/telegraf.js`):

1. `require('./handlers/middleware')` — auth, rate limiting, logging.
2. ~30 comandos en `src/handlers/commands/*.js` (uno por archivo, ver tabla).
3. `require('./handlers/text')` — handler de texto libre (NLP, ver skill
   `bot-cashy-nlp`).
4. `require('./handlers/photo')` — fotos de agenda (Gemini Vision).
5. `require('./handlers/actions')` y `require('./handlers/nlp-confirm')` —
   callbacks de botones inline.
6. `startApi()` — levanta la API del dashboard, **independiente** del bot
   (no bloquea ni depende de `bot.launch()`).
7. `bot.launch()` → luego `initModel()` (Gemini) y
   `obtenerCotizacionDolar()` (inicial + cada 3h, timer `unref()`d para no
   bloquear el shutdown).

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
  (`pendingAgendaConfirm`).
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
  `invite.service.createInviteCode`) → invitado usa `/unir <codigo>`
  (único camino público; `joinWithInviteCode`) → `resolveInviteCode` valida
  (con límite de intentos `MAX_INTENTOS_CODIGO`) → se agrega a
  `usuarios[]` del owner.

## Persistencia de clientes (`src/services/cliente.service.js`)

- `clientes.json` (gitignored) es la fuente local; si `USE_SUPABASE=true`,
  se sincroniza con la tabla `profiles` (best-effort, el archivo local
  siempre se escribe primero como backup).
- Todas las escrituras (`guardarClientes`, `eliminarCliente`) pasan por una
  cola (`encolarEscritura`) para serializar accesos concurrentes y evitar
  que dos registros simultáneos pisen el archivo.

## Dónde mirar el código fuente

- `src/index.js` — orden de bootstrap.
- `src/handlers/middleware.js`, `src/handlers/actions.js` — cross-cutting.
- `src/auth/index.js`, `src/services/invite.service.js`,
  `src/services/cliente.service.js` — auth/multiusuario.
- `src/state/index.js` — todos los TTLMaps y su uso.
