# Cashy — Contexto del Proyecto

Archivo de memoria para no re-leer docs en cada sesión.
Actualizar cuando cambie algo relevante.

---

## Qué es

Bot de Telegram para cashflow de un consultorio odontológico.
- Captura movimientos por chat (texto libre + flujo guiado)
- Almacena en Google Sheets (vista/respaldo) y Supabase (modelo objetivo)
- Dashboard web en React/Vite

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Bot | Node.js + Telegraf |
| NLP rápido | `quick_nlp.service.js` (regex/keywords) |
| NLP fallback | Gemini (gemini-2.5-flash-lite / flash) |
| Visión (fotos) | Gemini Vision (gemini-2.5-flash) |
| Persistencia principal | Supabase (cuando USE_SUPABASE=true) |
| Persistencia respaldo | Google Sheets (via google-spreadsheet) |
| Cotización dólar | Bluelytics API |
| Dashboard | React 19 + Vite 5 + react-router-dom 7 |
| Auth dashboard | JWT vía API propia + token key `cashy_token` |

---

## Entrypoint real

```
npm start → src/index.js
```
`index.js` raíz = legacy deshabilitado, solo referencia.

---

## Estructura src/

```
src/
  index.js              ← entrypoint real
  config/               ← vars de entorno centralizadas
  state/index.js        ← Maps de estado conversacional (TTLMap 30min)
  auth/index.js         ← autenticación Telegram + email
  lib/
    telegraf.js         ← instancia del bot
    supabase.js         ← cliente Supabase
    google.js           ← cliente Google Sheets
    bluelytics.js       ← cotización dólar
  handlers/
    middleware.js       ← rate limiting, auth check
    text.js             ← orquestador de texto (routing de flujos)
    photo.js            ← handler de fotos de agenda
    actions.js          ← callbacks de botones inline (confirm/cancel)
    commands/           ← un archivo por comando slash
  services/
    command.service.js  ← lógica de negocio compartida entre slash y NLP
    movimiento.service.js ← construir y persistir rowData
    db.service.js       ← capa unificada Sheet + Supabase
    sheet.service.js    ← acceso a Google Sheets
    sheet-format.service.js ← colores y formato
    gemini.service.js   ← NLP remoto
    quick_nlp.service.js ← NLP rápido local
    cotizacion.service.js ← dólar blue
    cliente.service.js  ← clientes registrados
    registration.service.js ← flujo de registro
    invite.service.js   ← invitaciones y códigos
    agenda.service.js   ← guardar turnos en tab Agenda
    vision.service.js   ← parsear fotos de agenda
  utils/
    date.js             ← esHoy, esEstaSemana, esEsteMes, normalizarFecha
    formatter.js        ← formatMonto, escapeMarkdown, sanitizarInput
    validation.js       ← validarTextoUsuario, validarMonto, validarCotizacion
    sheet-row.js        ← helpers normalizados de acceso a filas
    movimiento-v2.js    ← builders para schema v2
```

---

## Estado de flujos pending* (TTLMap, expiran 30min)

| Map | Qué espera |
|-----|-----------|
| `pendingRegistros` | usuario completando registro |
| `pendingCodigos` | usuario ingresando código de invitación |
| `pendingPayments` | usuario respondiendo método de pago |
| `pendingCotizaciones` | usuario ingresando cotización del dólar |
| `pendingDescripcion` | usuario ingresando descripción faltante |
| `pendingEdits` | usuario confirmando edición (steps: descripcion → monto → confirmar) |
| `pendingDeletes` | usuario confirmando eliminación |
| `pendingLimpiezas` | usuario confirmando limpieza |
| `pendingReinicios` | usuario confirmando reinicio |
| `pendingAgendaConfirm` | usuario confirmando turnos de foto |
| `pendingIngresoPacientes` | usuario en flujo guiado `/ingreso_paciente` |
| `docsCache` | cache de GoogleSpreadsheet docs (TTL 2h) |

---

## Columnas del Google Sheet

Fecha | Hora | Descripcion | Monto | Estado | Tipo | Moneda | MetodoPago | ID_Unico | MontoPesos | ID_Origen | Categoria | Paciente | Pagador | Profesional | Tratamiento | Proveedor | FechaPrestacion | FechaVencimiento | SaldoPendiente | ReferenciaId

- Egresos se guardan con **monto negativo**
- `montoPesos` es la base de reporting consolidado (siempre en ARS)
- `ID_Origen` = email del usuario o Telegram user ID

---

## Categorías del modelo

**Ingresos:** consulta, tratamiento, anticipo, sena, cuota, saldo_final, cobro_pendiente

**Egresos:** sueldos, honorarios, insumos, alquiler, expensas, servicios, impuestos, mantenimiento, software, otro_egreso

**Estados:** Cobrado, Pendiente, Pagado, Rechazado, Presentado OS (+ parcial planeado en v2)

---

## Dashboard web (dashboard/)

Ya es un dashboard completo y en uso activo (no un MVP de lectura) — permite
ver, filtrar, editar, cobrar y eliminar, con actualización en tiempo real
vía SSE cuando cambia algo desde el bot o desde otra sesión del dashboard.

```
dashboard/src/
  main.jsx            ← BrowserRouter wrappea todo
  App.jsx             ← Routes: /login (público), /, /movimientos, /agenda, /config (AuthGuard)
  hooks/
    useAuth.js        ← token key: 'cashy_token' (CRÍTICO - debe coincidir con api.js)
    useMovimientosEvents.js ← SSE (fetch + ReadableStream) para tiempo real
  services/
    api.js            ← axios, lee token de localStorage['cashy_token'], interceptor 401
                         (solo desloguea si el 401 corresponde al token vigente,
                         no a un request viejo en vuelo)
    supabase.js       ← cliente Supabase (existe, no se usa directo desde el dashboard;
                         todo pasa por axios → API propia)
  pages/
    Login.jsx         ← auth por Telegram ID + código 6 dígitos
    Dashboard.jsx     ← métricas (MetricCard) + "últimos movimientos"
    MovimientosPage.jsx ← tabla completa con filtros (tipo/moneda/fecha), edición y borrado
    AgendaPage.jsx    ← turnos del día, navegación de fecha, cobrar/marcar llegada
    ConfigPage.jsx    ← gestión de usuarios (solo admin)
  components/
    AuthGuard.jsx, Sidebar.jsx, NavBar.jsx, BottomNav.jsx
    MetricCard.jsx    ← card con desglose por moneda / listado de pendientes al hover o tap
    DatePickerButton.jsx ← botón calendario reutilizable (Movimientos y Agenda)
    NuevoMovimientoModal.jsx, CotizacionWidget.jsx, ErrorBoundary.jsx, PlusButton.jsx
```

**Ojo con egresos:** en DB son negativos → usar `Math.abs()` al mostrar y calcular neto.

**Build:** Vite 5.4.21 + plugin React estándar, sin problemas conocidos.
`npm run build` (dentro de `dashboard/`) genera `dist/`, que el backend sirve
como estático en producción. Corre además en CI (`.github/workflows/ci.yml`)
en cada push a `main`.

---

## Refactor — Estado actual (histórico)

Esta tabla seguía el plan de migración `index.js` legacy → `src/`, que antes
vivía en `README_REFACTOR_SDD.md` (con sus 8 "specs" numeradas) y se validaba
contra `QA_SPEC7_CHECKLIST.md`. Esos dos archivos se fusionaron y resumieron
dentro de `ROADMAP_CASHY_CLINICA.md` (secciones "7. Migración legacy
index.js → src/" y "8. QA conocido / pendiente de validación manual") y ya
no existen por separado — el detalle de cada spec sigue en el historial de
git si hace falta.

**Resumen del resultado:** la migración está completa en lo estructural — el
entrypoint oficial es `src/index.js`, no queda dependencia operativa del
legacy. Lo que sigue pendiente no es código sino validación manual: prueba
real de agenda por foto en Telegram, prueba real de los helpers de filas de
Sheet, y un QA extremo a extremo que ya encontró un par de gaps menores (el
flujo público de invitación está inconsistente entre `/start`+código y
`/unir CODIGO`, y `movimientos_v2`/`movimiento_eventos_v2` todavía no estaban
desplegadas en Supabase a la fecha de esa auditoría) — ver el detalle
actualizado en `ROADMAP_CASHY_CLINICA.md`.

---

## Roadmap de producto — Etapas

Detalle completo y actualizado en `ROADMAP_CASHY_CLINICA.md` (evitar duplicar
la tabla acá para que no se desincronice de nuevo). Resumen rápido:

| Etapa | Qué es | Estado |
|-------|--------|--------|
| 0 | Definición funcional | ✅ Decidido: clinica completa, pacientes directos primero |
| 1 | Normalizar movimiento (campos estructurados) | 🔄 Parcial (schema v2 en Supabase existe, el bot sigue escribiendo en v1) |
| 2 | Temporalidad real (fechas separadas) | 🔄 Campos en schema, falta captura completa |
| 3 | Cuentas por cobrar y pagar | ⏳ Pendiente |
| 4 | Reportes de gestión | ⏳ Pendiente |
| 5 | Configuración y alertas | ⏳ Pendiente |
| 6 | Web MVP | ✅ Hecha y superada — el dashboard ya permite editar/cobrar/eliminar, no solo leer |

**Decisiones fijas:**
- Supabase = modelo objetivo, Sheets = vista/respaldo durante transición
- mantener carga rápida por mensaje libre + flujo guiado para casos complejos
- `monto_pesos` = base de reporting consolidado (no `monto`)
- obras sociales no entran en MVP v1

---

## Feature: Cobro parcial con deuda residual

Intent: `cobro_parcial_con_deuda` en `nlp.js`
Parser: `matchCobroParcialConDeuda` en `quick_nlp.service.js` (regex, va primero en quickParse)

Frases que entiende:
- `pagaron 30000 y debe 30000`
- `Juan pagó 20000 y queda debiendo 15000`
- `cobré 15000 y le quedan 10000`
- `me pagaron 50k pero me siguen debiendo 20k`
- `María pagó 30 lucas y le faltan 20 lucas`

Genera dos movimientos en un solo mensaje:
1. Ingreso `Cobrado` por `montoCobrado`
2. Ingreso `Pendiente` por `montoDeuda` (misma descripción/paciente)

Para cobrar el pendiente después: `/cobrar [nombre]` o `ya me pagó [nombre]`

---

## Comandos existentes del bot

`/balance` `/hoy` `/semana` `/mes` `/ingresos` `/egresos` `/pendientes`
`/cobrar [nombre] [monto?]` `/pendiente` `/ingreso_paciente`
`/editar` `/eliminar` `/listar` `/debug` `/limpiar` `/regenerar_ids`
`/dolar` `/actualizardolar`
`/start` `/ayuda` `/help` `/cancelar`
`/codigo` `/unir` `/misusuarios` `/reiniciar`
`/sheet` `/palabras`

---

## Variables de entorno clave (.env raíz del proyecto)

```
BOT_TOKEN
AUTHORIZED_USER_ID
SPREADSHEET_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
ALLOWED_EMAILS
USE_SUPABASE         ← true/false
SUPABASE_URL
SUPABASE_ANON_KEY
GEMINI_API_KEY
GEMINI_MODEL         ← default: gemini-2.5-flash-lite
GEMINI_VISION_MODEL  ← default: gemini-2.5-flash
COTIZACION_DEFAULT   ← opcional, dólar hardcodeado
```

---

## Bugs/deuda técnica conocida

1. **`debug` command** — no usa helpers normalizados de `sheet-row.js` todavía (ver "QA conocido" en `ROADMAP_CASHY_CLINICA.md`).
2. **`esEstaSemana`** en `date.js` — usa "últimos 7 días" no semana calendario lunes-domingo. Puede ser intencional.
3. **Flujo de invitación inconsistente** — la documentación sugiere `/start` + código, el camino operativo real es `/unir CODIGO` (ver `ROADMAP_CASHY_CLINICA.md` sección 8).
4. ~~**Reportes mezclan `monto` y `montoPesos`**~~ — ✅ Resuelto. Todos los totales en `command.service.js` usan `montoPesos` (ingresos: `d.montoPesos`, egresos: `Math.abs(d.montoPesos)`). El detalle por línea sigue usando `formatMonto(d.monto, d.moneda)` para mostrar la moneda original.
5. ~~**Agenda ↔ movimientos no conectados**~~ — ✅ Resuelto. Cobrar un turno desde el dashboard genera el movimiento automáticamente.
6. ~~**Vite 8 build rompía con JSX**~~ — ✅ No reproducible. El dashboard usa Vite 5.4.21 y compila bien (`npm run build`, también corre en CI).
