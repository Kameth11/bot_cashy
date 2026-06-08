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
| Dashboard | React 19 + Vite 8 + react-router-dom 7 |
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

Fecha | Hora | Descripcion | Monto | Estado | Tipo | Moneda | MetodoPago | ID_Unico | MontoPesos | ID_Origen | Categoria | Paciente | Profesional | Tratamiento | Proveedor | FechaPrestacion | FechaVencimiento | SaldoPendiente

- Egresos se guardan con **monto negativo**
- `montoPesos` es la base de reporting consolidado (siempre en ARS)
- `ID_Origen` = email del usuario o Telegram user ID

---

## Categorías del modelo

**Ingresos:** consulta, tratamiento, anticipo, sena, cuota, saldo_final, cobro_pendiente

**Egresos:** sueldos, honorarios, insumos, alquiler, expensas, servicios, impuestos, mantenimiento, software, otro_egreso

**Estados:** Cobrado, Pendiente (+ parcial planeado en v2)

---

## Dashboard web (dashboard/)

```
dashboard/src/
  main.jsx            ← BrowserRouter wrappea todo
  App.jsx             ← Routes: /login (público) + /* (AuthGuard → AuthenticatedLayout)
  hooks/useAuth.js    ← token key: 'cashy_token' (CRÍTICO - debe coincidir con api.js)
  services/
    api.js            ← axios, lee token de localStorage['cashy_token'], interceptor 401
    supabase.js       ← cliente Supabase (creado pero no usado aún en el dashboard)
  pages/
    Login.jsx         ← auth por Telegram ID + código 6 dígitos + demo mode
    Dashboard.jsx     ← métricas + tabla movimientos (usa MetricCard, PlusButton)
    Proxim.jsx        ← placeholder para rutas futuras
  components/
    AuthGuard.jsx     ← redirect a /login si no autenticado
    Sidebar.jsx       ← nav: /, /movimientos, /nuevo, /config
    MetricCard.jsx    ← card reutilizable con variantes: ingresos/egresos/pendientes/neto
    PlusButton.jsx    ← botón PLUS con ícono Crown
```

**Ojo con egresos:** en DB son negativos → usar `Math.abs()` al mostrar y calcular neto.

**Build:** Vite 8 + rolldown. Hay un bug pendiente donde `npx vite build` falla con "Unexpected token" en JSX a pesar de que el plugin está bien configurado. `npm run dev` debería funcionar. Investigar o downgrade a Vite 5/6 si el build sigue fallando.

---

## Refactor — Estado actual (SDD)

| Spec | Qué es | Estado |
|------|--------|--------|
| Spec 1 | Runtime oficial | ✅ Hecho |
| Spec 2 | Agenda por foto | 🔄 En progreso (falta prueba real en Telegram) |
| Spec 3 | Filas Sheet normalizadas | 🔄 En progreso (falta prueba real + debug) |
| Spec 4 | Guardado unificado | ✅ Hecho |
| Spec 5 | text.js como orquestador | ✅ Hecho |
| Spec 6 | Delegación slash ↔ NLP | ✅ Hecho |
| Spec 7 | Paridad funcional total | ⏳ Pendiente (QA_SPEC7_CHECKLIST.md) |
| Spec 8 | Retiro del legacy | 🔄 En progreso (bloqueado por Spec 7) |

**Protocolo por sesión:** elegir una sola spec, definir acceptance antes de tocar código, cambios chicos, validar, actualizar este archivo.

**Próximo paso:** Spec 7 (QA) o cerrar pruebas reales de Spec 2 y Spec 3.

---

## Roadmap de producto — Etapas

| Etapa | Qué es | Estado |
|-------|--------|--------|
| 0 | Definición funcional | ✅ Decidido: clinica completa, pacientes directos primero |
| 1 | Normalizar movimiento (campos estructurados) | 🔄 Parcial (categoría, paciente, profesional ya en v2) |
| 2 | Temporalidad real (fechas separadas) | 🔄 Campos en schema, falta captura completa |
| 3 | Cuentas por cobrar y pagar | ⏳ Pendiente |
| 4 | Reportes de gestión | ⏳ Pendiente |
| 5 | Configuración y alertas | ⏳ Pendiente |
| 6 | Web MVP | ⏳ Pendiente (no prioridad hasta tener modelo sólido) |

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

1. **Vite 8 build falla** con JSX ("Unexpected token") — `npm run dev` funciona, producción build bloqueada. Posible fix: downgrade a Vite 5/6 o investigar config de oxc.
2. **supabase.js del dashboard** — cliente creado pero no se usa (todo va por axios → API propia).
3. **`debug` command** — no usa helpers normalizados de `sheet-row.js` todavía (Spec 3 pendiente).
4. **Agenda ↔ movimientos** — no están conectados aún (agenda guarda en tab separada, no genera movimiento financiero).
5. **`esEstaSemana`** en `date.js` — usa "últimos 7 días" no semana calendario lunes-domingo. Puede ser intencional.
6. ~~**Reportes mezclan `monto` y `montoPesos`**~~ — ✅ Resuelto. Todos los totales en `command.service.js` usan `montoPesos` (ingresos: `d.montoPesos`, egresos: `Math.abs(d.montoPesos)`). El detalle por línea sigue usando `formatMonto(d.monto, d.moneda)` para mostrar la moneda original.
