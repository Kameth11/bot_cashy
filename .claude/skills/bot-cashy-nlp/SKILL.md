---
name: bot-cashy-nlp
description: >-
  Flujo de procesamiento de lenguaje natural de bot_cashy: regex rápido,
  quick_nlp.service (parser local sin costo), gemini.service (IA con
  caching/cooldowns/fallback de modelos), y cómo se decide cuál usar. Usar
  cuando se trabaje en src/handlers/text.js, src/services/quick_nlp.service.js,
  src/services/gemini.service.js, src/handlers/nlp.js o nlp-confirm.js.
---

# bot_cashy — Flujo NLP

Objetivo: entender un mensaje de texto libre del usuario y convertirlo en un
movimiento (ingreso/egreso) o en un comando (`ver_balance`, `ver_pendientes`,
etc.) gastando lo mínimo posible en llamadas a Gemini.

## Orden de resolución (`src/handlers/text.js`)

1. **Flujos conversacionales pendientes primero**: si el usuario tiene un
   estado pendiente en `state` (TTLMaps: `pendingNlpMovimientos`,
   `pendingRegistros`, `pendingIngresoPacientes`, `pendingDescripcion`,
   `pendingCotizaciones`, `pendingEdits`, `pendingPayments`, etc.), el texto
   se interpreta como respuesta a ese flujo y **no pasa por NLP**.

2. **Regex de comando explícito** (`regexMsg`):
   ```
   /^(consulta|servicio|gasto|pendiente)\s+(.+?)\s+(?:\$|U\$|USD|€|EUR)?\s*(-?\d+(?:\.\d{1,2})?)\s*((?:efectivo|transferencia|tarjeta))?$/i
   ```
   Si matchea → camino rápido sin IA: extrae descripción/monto/moneda/método,
   infiere `categoria` (`inferirCategoriaDesdeComando`), `pacienteNombre`,
   `profesionalNombre`, `tratamientoNombre` (`inferirCamposDesdeComando`,
   `extraerProfesionalDesdeTexto`, `extraerTratamientoDesdeTexto`) y guarda
   directo con `cmd.guardarMovimiento` (vía `db.service.addRow`).

3. **Si no matchea el regex** → `quickParse(text)` (`quick_nlp.service.js`,
   ~925 líneas, 100% regex/heurísticas, sin costo ni latencia de red):
   - Detecta intents de consulta (`ver_balance`, `ver_hoy`, `ver_semana`,
     `ver_mes`, `ver_ingresos`, `ver_egresos`, `ver_pendientes`, `ver_dolar`,
     `actualizardolar`, `ver_sheet`, `ver_ayuda`, `listar_movimientos`, etc.)
     vía listas de palabras/frases.
   - Detecta `registrar_movimiento` con extracción de monto
     (`extraerMonto`), método (`extraerMetodo`), paciente/profesional/
     pagador/proveedor/tratamiento, y categoría (`inferirCategoriaRapida`).
   - `shouldHandleWithQuickParseFirst(result)`: si el intent **no** es
     `registrar_movimiento`, o si es `registrar_movimiento` pero ya extrajo
     `monto`/`descripcion`/`metodo_pago`, se resuelve **acá mismo** vía
     `handleNLPIntent` (`handlers/nlp.js`) sin llamar a Gemini.

4. **Si quickParse no alcanzó confianza suficiente** y
   `geminiService.canAttemptRemoteNlp()` es true → una única llamada a
   `parseMessage(userId, text)`: prompt general (`SYSTEM_PROMPT`) que
   devuelve `{ intent, entities }`, incluyendo `entities.estado`
   (`"Cobrado"`/`"Pendiente"`) para `registrar_movimiento`. Si el intent no
   es `desconocido`, se procesa con `handleNLPIntent`.

5. **Fallback final**: si Gemini no resolvió (`canAttemptRemoteNlp()` false,
   error, o intent `desconocido`), se reintenta `quickResult` si existe; si
   nada funcionó, se responde con sugerencia de formato manual.

`state.processingNlp` (Set) evita procesar dos mensajes del mismo usuario en
paralelo — si ya hay uno en vuelo, responde "Espera, todavía estoy
procesando...". Test de regresión en `tests/handlers.processing-nlp.test.js`.

## Intents especiales de dos movimientos (parcial con deuda)

`quickParse` reconoce dos frases que generan **dos movimientos de una sola
vez** (la parte saldada + el saldo restante como Pendiente). Van primero en
el dispatch de `quickParse` porque contienen dos montos y los matchers
generales los partirían mal:

- `cobro_parcial_con_deuda` — un paciente paga una parte y debe el resto
  ("cobré 300 y deben 200"). Genera Ingreso/Cobrado + Ingreso/Pendiente.
  `matchCobroParcialConDeuda`.
- `pago_parcial_con_deuda` — el consultorio le paga una parte a un
  proveedor/financiera y todavía le debe ("pagamos 500 a Dental Sur, debemos
  200"). Genera Egreso/Cobrado + Egreso/Pendiente. `matchPagoParcialATercero`,
  va ANTES de `matchCobroParcialConDeuda` por ser más específico (exige
  "a [tercero]"). Handlers en `handlers/nlp.js`.

**Dirección del dinero (ingreso vs egreso)**: el bug clásico es confundir "se
pagó [la consulta]" (ingreso que cobramos) con "se pagó A [un tercero]"
(egreso). `quick_nlp.service.js` distingue con `VERBOS_PAGO_A_TERCERO`
(pagué/pagamos/pagó/abonó… **sin** las formas de 3ª persona plural como
"pagaron/transfirieron", que ya están tomadas por la convención "le
transfirieron a X" = X paciente). `VERBOS_DEUDA` reconoce el saldo restante
(debe/deben/debemos/quedamos debiendo/falta…). `LIMITE_ENTIDAD` frena la
captura del nombre antes de tragarse la cláusula de deuda. Tests en
`tests/quick-nlp.service.test.js`.

## gemini.service.js — detalles operativos

- **Modelo activo**: `initModel()` (llamado al boot, después de
  `bot.launch()`) prueba modelos en orden hasta encontrar uno que responda
  "ok": `[activeModelName, GEMINI_MODEL (env, default
  'gemini-2.5-flash-lite'), ...FALLBACK_MODELS]`, donde `FALLBACK_MODELS =
  ['gemini-2.5-flash-lite', 'gemini-2.5-flash']`.
- **Timeout por intento**: `API_TIMEOUT_MS = 8000` (AbortController).
- **Caching**: `nlpCache` (Map en memoria, sin TTLMap) — clave
  `${userId}:${text.toLowerCase().trim()}`, `CACHE_TTL_MS = 60000` (1 min).
  Mismo texto del mismo usuario dentro de 1 min no vuelve a llamar a Gemini.
- **Cooldowns globales** (afectan a todos los usuarios):
  - `RATE_LIMIT_COOLDOWN_MS = 65000` tras un 429/quota.
  - `SERVICE_ERROR_COOLDOWN_MS = 180000` tras 500/502/503/504/overloaded.
  - `canAttemptRemoteNlp()` = `GEMINI_API_KEY` configurada Y ninguno de los
    dos cooldowns activo.
- **`repairJSON`**: intenta reparar JSON truncado por `maxOutputTokens: 512`
  (cierra llaves faltantes progresivamente, o trunca al último par
  clave/valor completo).
- **Normalización**: `normalizarCategoria` valida contra la misma lista
  cerrada que `ALL_CATEGORIES` en `src/utils/movimiento-v2.js` (debe
  mantenerse sincronizada si se agregan categorías).
- **Generation config**: `temperature: 0.1`, `responseMimeType:
  "application/json"`, con `SYSTEM_PROMPT` como `systemInstruction`.
- **Media (foto/voz) con semáforo**: las llamadas a Gemini Vision
  (`procesarFotoAgenda` en `handlers/photo.js`) y de transcripción de audio
  (`geminiService.transcribirAudio` en `handlers/voice.js`) se envuelven con
  `geminiMediaSemaphore.run(...)` (`src/lib/semaphore.js`, máx 3 en vuelo,
  cola de 12) para que N usuarios mandando media a la vez no disparen N
  llamadas simultáneas + N imágenes en RAM. No quitar ese wrapper (guard en
  `tests/handlers.gemini-semaphore.test.js`).

## Después de resolver el intent: confirmación

- `handlers/nlp.js` (`handleNLPIntent`) decide: si es un comando de consulta
  (`ver_balance`, etc.) lo ejecuta directo; si es `registrar_movimiento` con
  datos suficientes, arma un mensaje de confirmación con botones inline
  (`crearMensajeConfirmacion`, `confirmButtons` en `handlers/actions.js`) y
  guarda el borrador en `state.pendingNlpMovimientos` (TTL 5 min).
- `handlers/nlp-confirm.js` maneja los callbacks de esos botones
  (confirmar/editar campo/descartar) y, al confirmar, llama a
  `cmd.guardarMovimiento` / `cmd.registrarMovimientoDesdeNLP` →
  `db.service.addRow`.
- Si falta moneda/método/descripción, el flujo cae en los TTLMaps
  `pendingCotizaciones` / `pendingPayments` / `pendingDescripcion` para pedir
  el dato faltante en el próximo mensaje (ver paso 1 de este documento).

## Dónde mirar el código fuente

- `src/handlers/text.js` — orquestación completa, regex rápido,
  flujos conversacionales pendientes.
- `src/services/quick_nlp.service.js` — parser local (intents de consulta +
  extracción de entidades de movimiento).
- `src/services/gemini.service.js` — integración Gemini (modelos, caching,
  cooldowns, prompts, normalización).
- `src/handlers/nlp.js` — `handleNLPIntent`, dispatch de intents.
- `src/handlers/nlp-confirm.js` — confirmación/edición de movimientos
  pendientes.
