---
name: bot-cashy-db
description: >-
  Capa de datos de bot_cashy: columnas de Google Sheets, schema Supabase v1
  (legacy `movimientos`) y v2 (`movimientos_v2` + `movimiento_eventos_v2`),
  detección de capacidades, dual-write y mapeo legacy↔v2. Usar cuando se
  trabaje en src/services/db.service.js, src/services/sheet.service.js,
  src/utils/movimiento-v2.js, o en cualquier archivo sql/.
---

# bot_cashy — Capa de datos

Toda lectura/escritura de movimientos pasa por `src/services/db.service.js`,
que actúa como fachada única. El resto del código (handlers, services de
movimientos) **nunca** debería hablar directo con Google Sheets o Supabase.

## Modo de almacenamiento: `USE_SUPABASE`

- `USE_SUPABASE=false` (default): todo va a Google Sheets. `db.service.js`
  delega 1:1 en `sheet.service.js` (`getSheetCliente`, `getRows`, `addRow`, etc.).
- `USE_SUPABASE=true` y Supabase disponible (`isAvailable()` en
  `src/lib/supabase.js`, requiere `SUPABASE_URL` + service/anon key +
  paquete `@supabase/supabase-js` instalado): los movimientos viven
  primero en Supabase, y el Sheet se mantiene como **backup de solo
  lectura** vía dual-write.
- Si Supabase falla en cualquier punto, todo cae con fallback a Sheets
  (`getSheetService().getSheetCliente(userId)` / `addRow`).

## Modelo Sheets (v1 / legacy)

Columnas (`REQUIRED_SHEET_HEADERS` en `sheet.service.js`):

```
Fecha | Hora | Descripcion | Monto | Estado | Tipo | Moneda | MetodoPago |
ID_Unico | MontoPesos | ID_Origen | Categoria | Paciente | Pagador |
Profesional | Tratamiento | Proveedor | FechaPrestacion | FechaVencimiento |
SaldoPendiente | ReferenciaId
```

- `ensureSheetStructure(sheet)` agrega headers faltantes automáticamente
  (no se rompe si un sheet viejo no tiene todas las columnas nuevas).
- `Estado`: `Cobrado` | `Pendiente`. `Tipo`: `Ingreso` | `Egreso`.
- `valueInputOption` por defecto de `addRow` es `USER_ENTERED` → cualquier
  string que empiece con `=+-@` se interpreta como fórmula. Por eso
  `sanitizarInput` (en `src/utils/formatter.js`) antepone `'` a esos valores.

## Modelo Supabase v1 (legacy, `sql/schema.sql` + `sql/schema_mvp_odontologia.sql`)

- `profiles`: perfil por usuario (`id` = Telegram userId, `email`,
  `sheet_id`, `usuarios[]`, `plan`, `web_user_id`).
- `movimientos`: tabla legacy plana, columnas básicas (`fecha`, `hora`,
  `descripcion`, `monto`, `estado`, `tipo`, `moneda`, `metodo_pago`,
  `id_unico`, `monto_pesos`, `id_origen`, `user_id`).
  - `schema_mvp_odontologia.sql` le agrega columnas extendidas:
    `categoria`, `medio_pago`, `referencia_id` (CHECK constraints,
    `fecha` pasa de TEXT a DATE).
  - `db.service.resolveLegacyCapabilities()` detecta en runtime si estas
    columnas extendidas existen (`legacyCapabilityCache`, cacheado en
    memoria por proceso). Si no existen, `addRow` borra
    `categoria`/`medio_pago`/`referencia_id` del payload antes de insertar.
- También define `profesionales`, `obras_sociales`, `prestaciones` con RLS
  (`web_user_id = auth.uid()`).
- **Atención**: `sql/profesionales.sql` (13 líneas, `telegram_user_id TEXT
  UNIQUE`, política "Service role full access") es un schema **distinto y
  más viejo** de `profesionales` que el de `schema_mvp_odontologia.sql`
  (`user_id BIGINT FK`, `especialidad`, `porcentaje_honorarios`). Si se toca
  esta tabla, verificar contra la base real cuál de los dos está aplicado
  antes de asumir columnas.

## Modelo Supabase v2 (`sql/schema_v2_draft.sql`)

- `movimientos_v2`: modelo financiero rico — `tipo_movimiento`
  (ingreso/egreso), `categoria` (lista cerrada vía CHECK, igual a
  `ALL_CATEGORIES` en `src/utils/movimiento-v2.js` y a
  `normalizarCategoria` en `gemini.service.js`), `estado_pago`
  (`pendiente|parcial|cobrado|pagado|vencido|cancelado`), `monto_original`,
  `monto_pesos`, `saldo_pendiente`, `metodo_pago`, fechas (`fecha_prestacion`,
  `fecha_cobro_real`, `fecha_vencimiento`, `fecha_carga`), `legacy_row_id`
  (FK lógica al `id` de `movimientos`), `referencia_id`, `notas`, etc.
- `movimiento_eventos_v2`: log de eventos (`creacion`, `cobro_total`,
  `cobro_parcial`, `pago_total`, `pago_parcial`) — un registro por cada
  transición de `saldo_pendiente`.
- `db.service.resolveV2Capabilities()` hace `select id limit 1` contra ambas
  tablas al primer uso y cachea el resultado (`v2CapabilityCache`,
  `v2CapabilityPromise` evita checks concurrentes duplicados). Si las tablas
  v2 no existen todavía, el bot sigue funcionando solo con v1 (loguea una
  vez "Supabase v2 no disponible todavia").

## Flujo de escritura (`addRow`, en `db.service.js`)

1. Si no hay Supabase → solo Sheets (`sheet.addRow` + `aplicarColorMontoEnFila`).
2. Si hay Supabase:
   - `ensureProfile(userId)` — crea/asegura fila en `profiles`.
   - Inserta en `movimientos` (v1), recortando columnas si
     `!extendedMovimientos`.
   - Si falla el insert → fallback total a Sheets y se retorna `null`.
   - Si OK → `insertMovimientoV2FromLegacy(...)`: construye el payload v2
     con `buildMovimientoV2Payload` (infiere `categoria`, `estado_pago`,
     `saldo_pendiente`, fechas) e inserta en `movimientos_v2` + evento
     `creacion` en `movimiento_eventos_v2` (si las tablas existen).
   - **Dual-write**: además escribe la misma fila en el Google Sheet como
     backup (errores acá se ignoran — Supabase es la fuente de verdad).

## Flujo de lectura (`getRows` / `obtenerDatosSheet`)

- Sin Supabase: lee directo del Sheet.
- Con Supabase: `resolveReadModelRows()` trae `movimientos` (legacy) +
  `movimientos_v2` filtrando los v2 que YA tienen `legacy_row_id`
  correspondiente a un row legacy (para no duplicar). El resultado combinado
  se ordena por fecha/hora de carga.
- Cada fila legacy se envuelve con `buildLegacySupabaseRowWrapper` y cada
  fila v2-only con `buildV2SupabaseRowWrapper` — ambos exponen
  `.get(field)` / `.set(field, value)` / `.save()` / `.delete()` con los
  mismos nombres de columna que usa el resto del código para filas de
  Sheets (`Fecha`, `Monto`, `Estado`, etc.), de forma que
  `movimiento.service.js` y los handlers no necesitan saber si la fila vino
  de Sheets o de Supabase.

## Actualizaciones y borrados (cobros, ediciones)

- `findRowByIdUnico(userId, idUnico)` → busca entre los wrappers de
  `getRows()`.
- `updateMovimiento` / `deleteMovimiento` operan sobre el wrapper
  (`.save()` / `.delete()`), que internamente:
  - Para legacy: actualiza `movimientos`, sincroniza el Sheet
    (`syncRowUpdateToSheet`/`syncRowDeleteToSheet` via
    `findSheetRowByIdUnico`), y propaga el cambio a `movimientos_v2`
    (`syncLegacyUpdateToV2` / `syncLegacyDeleteToV2`), generando un evento
    `*_total`/`*_parcial` en `movimiento_eventos_v2` si `saldo_pendiente`
    bajó.
  - Para v2-only: actualiza `movimientos_v2` directo + evento de transición.
- `buildMovimientoV2UpdatePayload` recalcula `estado_pago`,
  `saldo_pendiente`, `monto_pesos` y `fecha_cobro_real` combinando el row
  legacy actual con los `updates` entrantes — es la pieza más delicada del
  mapeo; si se cambia, revisar `mapLegacyStateToV2` y
  `getOutstandingFactor`/`getCompatibleAmountBase` (manejan cobros
  parciales con conversión de moneda).

## Dónde mirar el código fuente

- `src/services/db.service.js` — fachada, capability detection, wrappers.
- `src/services/sheet.service.js` — acceso directo a Google Sheets,
  `REQUIRED_SHEET_HEADERS`, `ensureSheetStructure`.
- `src/utils/movimiento-v2.js` — toda la lógica de mapeo legacy↔v2
  (`buildMovimientoV2Payload`, `buildMovimientoV2UpdatePayload`,
  `inferirCategoriaMovimiento`, `mapLegacyStateToV2`, `ALL_CATEGORIES`).
- `src/lib/supabase.js` — cliente Supabase (`getSupabase`, `isAvailable`).
- `src/lib/google.js` — cliente Google Sheets (service account JWT).
- `sql/schema.sql`, `sql/schema_mvp_odontologia.sql`,
  `sql/schema_v2_draft.sql`, `sql/profesionales.sql` — DDL.
