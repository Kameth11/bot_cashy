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
procesando...".

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
