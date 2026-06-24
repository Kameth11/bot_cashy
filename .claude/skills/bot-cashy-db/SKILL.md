---
name: bot-cashy-db
description: >-
  Capa de datos de bot_cashy: columnas de Google Sheets, schema Supabase v1
  (legacy `movimientos`) y v2 (`movimientos_v2` + `movimiento_eventos_v2`),
  aislamiento multi-tenant (`tenant_id` + `forTenant`), detección de
  capacidades, dual-write best-effort y mapeo legacy↔v2. Usar cuando se
  trabaje en src/services/db.service.js, src/services/sheet.service.js,
  src/utils/movimiento-v2.js, src/lib/tenant-db.js,
  src/services/tenant.service.js, o en cualquier archivo sql/.
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

## Aislamiento multi-tenant (Fase 2 — OBLIGATORIO)

Cada consultorio es un **tenant**. Las tablas de negocio tienen `tenant_id`
(tabla `tenants`, migraciones `sql/migrations/001..003`). **Toda query a una
tabla de negocio (`movimientos`, `profesionales`) DEBE pasar por
`forTenant(tenantId).from(tabla)` de `src/lib/tenant-db.js`** — nunca
`getSupabase().from('movimientos')` directo.

- `forTenant(tenantId)` inyecta `.eq('tenant_id', tenantId)` automáticamente en
  select/update/delete y agrega `tenant_id` en insert/upsert. Lanza si
  `tenantId` es falsy o si la tabla no está en `SCOPED_TABLES`
  (`{'movimientos','profesionales'}`). Un `.eq('tenant_id')` olvidado = fuga de
  datos entre consultorios.
- `resolveTenantId(userId)` (`src/services/tenant.service.js`) mapea el Telegram
  userId → `tenant_id` (resolviendo el ownerId si es un usuario invitado),
  cacheado en memoria. `invalidateTenantCache(userId)` lo limpia.
- `profiles` y `tenants` quedan **fuera** de `forTenant` a propósito: son las
  tablas que definen el mapeo userId→tenantId, se consultan con `getSupabase()`
  directo antes de tener el tenant resuelto.
- Red de seguridad: `scripts/check-tenant-isolation.js` (step de CI
  `npm run check:tenant`) falla el build si aparece `.from('movimientos'|
  'profesionales')` fuera de `tenant-db.js`. Excepción: comentario
  `// tenant-isolation-ignore` para probes de capability (no leen datos de
  usuario). Tests de runtime del wrapper en `tests/lib.tenant-db.test.js`.
- RLS en Supabase es **defensiva** (policy `solo_service_role`): cierra la
  puerta a la `anon_key`, NO filtra por tenant a nivel Postgres. El filtrado
  real es server-side vía `forTenant`. Ver `ARCHITECTURE.md` sección 3.

## Modelo Sheets (v1 / legacy)

Columnas (`REQUIRED_SHEET_HEADERS` en `sheet.service.js`):

```
Fecha | Hora | Descripcion | Monto | Estado | Tipo | Moneda | MetodoPago |
ID_Unico | MontoPesos | ID_Origen | Categoria | Paciente | Pagador |
Profesional | Tratamiento | Proveedor | FechaPrestacion | FechaVencimiento |
SaldoPendiente | ReferenciaId | FechaCobro
```

- `FechaCobro` (Supabase: `fecha_cobro`, migración `sql/migrations/005_fecha_cobro.sql`)
  registra **cuándo se cobró realmente** un pendiente, distinto de la `Fecha`
  original del movimiento. Se stampea SOLO en la transición real
  Pendiente→Cobrado (`doEjecutarCobrar` en `command.service.js` y
  `updateMovimiento` en `db.service.js`), no al crear algo directamente
  Cobrado ni en cobros parciales. Volver a Pendiente la limpia. El dashboard
  ordena los cobrados por esta fecha y muestra "(cobrado DD/MM)".

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
  - `db.service.resolveLegacyCapabilities()` detecta en runtime qué columnas
    existen (`legacyCapabilityCache`, cacheado por proceso) en **tres flags
    independientes**: `extendedMovimientos`
    (`categoria`/`medio_pago`/`referencia_id`), `extendedCampos`
    (`paciente`/`profesional`/`tratamiento`/`proveedor`/`fecha_prestacion`/
    `fecha_vencimiento`) y `fechaCobro` (`fecha_cobro`, migración 005). Cada
    flag controla qué campos borra `addRow` del payload si esa columna aún no
    existe. **Importante**: `fechaCobro` es un flag SEPARADO a propósito —
    agruparlo con `extendedCampos` haría que, hasta correr la migración 005,
    los campos que SÍ existen dejaran de escribirse.
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
   - **Dual-write best-effort en background**: la escritura al Google Sheet se
     dispara con `runInBackground(userId, fn)` (`src/lib/write-queue.js`) — corre
     bajo el lock del usuario pero SIN bloquear la respuesta. Supabase es la
     fuente de verdad; si Sheets está lento o sobre cuota, no afecta al bot/
     dashboard. Lo mismo para update/delete (`syncRowUpdateToSheet`/
     `syncRowDeleteToSheet` van en background). No poner `await` sobre esto.

## Flujo de lectura (`getRows` / `obtenerDatosSheet`)

- Sin Supabase: lee directo del Sheet.
- Con Supabase: `resolveReadModelRows()` trae `movimientos` (legacy, vía
  `fetchLegacyRowsForUser` que usa `forTenant`) + `movimientos_v2` filtrando
  los v2 que YA tienen `legacy_row_id` correspondiente a un row legacy (para
  no duplicar). El resultado combinado se ordena por fecha/hora de carga.
- **Lectura acotada (escalabilidad)**: `fetchLegacyRowsForUser` trae como
  mucho `MAX_MOVIMIENTOS_READ` (20000) filas, `order('created_at', desc)` —
  guard contra que un tenant con años de historia traiga todo en cada fetch.
  No es paginación real; cuando un tenant se acerque a ese número, toca paginar.
  Hay test de regresión en `tests/db.service.boundedRead.test.js`.
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
