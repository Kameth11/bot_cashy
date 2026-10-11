# bot_cashy — Contexto del Proyecto

Bot de Telegram + dashboard web para gestión de cashflow de un consultorio médico.
Registra ingresos/egresos en lenguaje natural y los guarda en Google Sheets individuales por usuario (+ Supabase opcional).

**Alcance de negocio**: hoy hay un cliente real, pero la intención es venderlo
a otros consultorios (SaaS multi-tenant). Esto todavía NO está implementado
a nivel de datos/seguridad — antes de tocar arquitectura, auth, o el modelo
de datos, leer `ARCHITECTURE.md` (decisiones de fondo, plan de multi-tenancy,
seguridad pendiente). Para qué falta del producto en sí (categorías,
reportes, etc.), ver `ROADMAP_CASHY_CLINICA.md`.

---

## Stack

- **Runtime**: Node.js 20+ (el build del dashboard lo requiere)
- **Bot**: Telegraf (Telegram)
- **Storage**: Google Sheets por usuario (service account)
- **AI Vision**: Gemini (lectura de fotos de agenda)
- **Dólar**: API Bluelytics (cotización blue)
- **Tests**: Jest
- **Entry point**: `src/index.js` (NO usar `index.js` raíz, está deprecado)

---

## Estructura

> **Nota (2026-09-24, /doctor):** se sacó de acá el árbol de directorios
> completo — era 100% reconstruible corriendo `ls`/`find` en el repo, así
> que no aportaba nada que una sesión nueva no pudiera ver sola en
> segundos; mantenerlo synced a mano era puro costo de contexto en cada
> sesión sin beneficio. Si hace falta volver a tenerlo acá, está en el
> historial de git de este archivo (`git log -p -- CLAUDE.md`, commit del
> recorte hecho por /doctor) — es un revert de una línea.

El dashboard se sirve desde el mismo proceso/servicio que el bot (Express
sirve el build estático de `dashboard/dist`). Tiene su propia API (`src/api/`)
montada en el mismo `src/index.js`. Auth del dashboard: **"Entrar con Google"** (opcional,
`GOOGLE_CLIENT_ID` + migración 014; se vincula la primera vez desde el bot, nunca por
email), **"Entrar con Telegram"**
(deep link/QR + confirmación en el bot, `login-telegram.service.js`; ver
`ARCHITECTURE.md` sección 4) o, como alternativa, código de Telegram +
JWT de 14 días con renovación deslizante y tope absoluto de 90 días (ver
`ARCHITECTURE.md` sección 4; falta moverlo a cookie httpOnly).

---

## Arquitectura general

### Bootstrap (`src/index.js`)

1. Se registra middleware (auth, rate limiting, logging).
2. Se registran ~30 comandos (`/start`, `/balance`, `/cobrar`, etc. — ver tabla más abajo).
3. Se registran handlers de texto libre, fotos, y callbacks de botones (confirmación NLP).
4. Se levanta la API del dashboard (`startApi()`), independiente del bot.
5. `bot.launch()` y luego `initModel()` (Gemini) + `obtenerCotizacionDolar()` (inicial + cada 3h).

### Flujo de un mensaje de texto

```
Telegram → middleware (auth/rate-limit) → handlers/text.js
  → regex rápido (comandos tipo "consulta ... $monto ...")
  → si no matchea: quick_nlp.service (regex local, sin costo)
  → si quick_nlp no resuelve con confianza: gemini.service (IA)
  → confirmación al usuario (botones inline) → nlp-confirm.js
  → movimiento.service.js → db.service.js (addRow)
  → Google Sheets (+ Supabase si USE_SUPABASE=true)
```

Para el detalle completo del parsing NLP (regex, quickParse, Gemini, caching,
fallback de modelos), ver el skill `bot-cashy-nlp`.

Para el detalle completo de la capa de datos (columnas de Sheets, schema
Supabase v1/v2, capability detection, dual-write, migración legacy→v2), ver
el skill `bot-cashy-db`.

Para el listado completo de handlers/comandos y el routing de callbacks, ver
el skill `bot-cashy-arquitectura`.

---

> **Nota (2026-09-24, /doctor):** se sacó de acá la sección "Comandos"
> (`npm start` / `npm test`) — son exactamente los scripts que ya figuran
> en `package.json`, así que no hacía falta duplicarlos. Para recuperarla,
> ver `git log -p -- CLAUDE.md` (mismo commit de /doctor) y revertir esa
> parte.

---

## Variables de entorno (.env)

```
BOT_TOKEN=                        # Token de @BotFather
AUTHORIZED_USER_ID=               # Telegram ID del admin
SPREADSHEET_ID=                   # Google Sheet del admin
GOOGLE_SERVICE_ACCOUNT_EMAIL=     # Email de la service account
GOOGLE_PRIVATE_KEY=               # Clave privada (con \n escapados)
ALLOWED_EMAILS=                   # Emails autorizados separados por coma
GEMINI_VISION_MODEL=              # gemini-2.5-flash (default recomendado)
GEMINI_MODEL=                     # gemini-2.5-flash-lite (para texto barato)
COTIZACION_DEFAULT=               # Fallback si falla Bluelytics
```

---

## Modelo de datos (Google Sheets)

Columnas del sheet por usuario (`REQUIRED_SHEET_HEADERS` en `sheet.service.js`):
`Fecha | Hora | Descripcion | Monto | Estado | Tipo | Moneda | MetodoPago | ID_Unico | MontoPesos | ID_Origen | Categoria | Paciente | Pagador | Profesional | Tratamiento | Proveedor | FechaPrestacion | FechaVencimiento | SaldoPendiente | ReferenciaId`

- **Moneda**: `Pesos` o `Dólares`
- **Estado**: `Cobrado` o `Pendiente`
- **Tipo**: `Ingreso` o `Egreso`
- **ID_Origen**: email del usuario (o Telegram ID si no tiene email)
- Los montos en dólares se convierten a pesos usando cotización del día

Qué tiene realmente la base de Supabase: `sql/verificar_estado.sql` (solo lectura;
las migraciones se corren a mano y no queda registro). Plan para volverla más
sólida (RLS, trazabilidad de migraciones, fechas reales en `movimientos`,
reconciliación Sheets↔Supabase): `PLAN_BASE_DE_DATOS.md`.

Esto es el modelo "legacy"/v1, fuente de verdad cuando `USE_SUPABASE=false`.
Cuando Supabase está habilitado conviven este modelo y un modelo v2
(`movimientos_v2` + `movimiento_eventos_v2`) más rico, con detección de
capacidades y mapeo automático entre ambos. Ver skill `bot-cashy-db` para el
detalle completo.

---

## Registro de movimientos (lenguaje natural)

```
# Ingreso en pesos
consulta Juan Perez $15000 efectivo

# Ingreso en dólares
servicio Endodoncia U$50 transferencia

# Egreso
gasto Insumos $-500
```

### Comprobantes por foto / PDF

Una foto o PDF la clasifica la IA (agenda / factura-ticket / transferencia).
Las facturas y tickets se leen con Gemini Vision y pasan por la misma
confirmación que el texto (`nlp-confirm.js`); el comprobante queda en la
pestaña `Comprobantes` vinculado al movimiento (`ReferenciaId = comp:<id>`).
Plan completo, fases y decisiones en `PLAN_COMPROBANTES.md`.

---

## Comandos del bot

| Comando | Función |
|---|---|
| `/start` | Bienvenida / registro de nuevo usuario |
| `/balance` | Resumen completo (hoy, semana, mes) |
| `/hoy` | Movimientos del día |
| `/pendientes` | Movimientos sin cobrar |
| `/semana` | Resumen semanal |
| `/mes` | Balance del mes |
| `/ingresos` | Lista de ingresos |
| `/egresos` | Lista de egresos |
| `/dolar` | Ver cotización actual |
| `/actualizardolar` | Actualizar cotización |
| `/cobrar ultimo` | Cobrar último movimiento |
| `/cobrar [nombre]` | Cobrar por paciente |
| `/ayuda` | Todos los comandos |
| `/personal` | Resumen del mes de finanzas personales |
| `/viaje` | Ver / abrir / cerrar un viaje (agrupa gastos personales) |
| `/google` | Ver / quitar la cuenta de Google vinculada para entrar al dashboard |
| `/casa` | Gastos compartidos: resumen, saldos, invitar, saldar (ver sección Casas) |

---

## Chat web (mismo bot, dentro del dashboard)

El dashboard tiene un chat con Cashy (barra abajo, se agranda a panel) que es
**el mismo bot de Telegram**, no una copia: `src/lib/canal-web.js` arma un
update con la forma de Telegram y corre `bot.middleware()` con un objeto
`Telegram` propio que guarda las respuestas en un historial en memoria en vez
de mandarlas a Telegram. Mismas reglas, NLP, comandos, botones de confirmación,
permisos y cuota de IA. Lo que el bot le manda a **otro** chat (avisos al
dueño, al profesional) sigue saliendo por Telegram.

- **API**: `GET /api/chat`, `POST /api/chat/mensaje`, `POST /api/chat/audio`
  (el navegador convierte lo grabado a WAV mono 16 kHz con
  `dashboard/src/utils/audioWav.js`; si no puede, manda el original y el MIME
  llega a Gemini tal cual),
  `POST /api/chat/boton` (solo `callback_data` de un botón real de ese
  mensaje). Evento SSE `chat_updated`. Rutas en `src/api/chat.routes.js`.
- **Front**: `dashboard/src/components/ChatWidget.jsx`. Se muestra en todas las
  pantallas (consultorio, Personal y Casa): el ámbito de cada mensaje lo decide
  el bot con sus reglas de siempre, no la pantalla en la que estés. Las tres
  pantallas ya se refrescan solas cuando el bot guarda (SSE
  `movimientos_updated`).
- **Grabación**: `dashboard/src/services/grabadora.js` tiene un único punto de
  cierre (enviar, descartar, máximo, error, app en segundo plano o micrófono
  tomado por otra app); siempre suelta el micrófono y avisa una sola vez.
- **Sin conexión**: lo escrito/grabado queda en IndexedDB
  (`dashboard/src/services/chatCola.js`) y se manda solo al volver internet.
  Confirmar (botones) requiere conexión.
- **Fotos y PDFs**: botón 📎 del chat → `POST /api/chat/archivo` (el cliente
  achica las fotos a 2000 px en JPEG, tope 10 MB). Llega a `photo.js` como un
  `document` de Telegram, así que clasifica (agenda / factura / transferencia),
  lee con Gemini y pide confirmación igual que en Telegram; lo que se escribe
  junto al archivo va como `caption` (pista). Los archivos web llevan un
  `file_id` con prefijo `web-` (`src/lib/archivo-web.js`): no se guarda
  referencia `tg:` falsa y, sin Storage de Supabase, `comprobante-registro`
  los respalda por Telegram. También entran en la cola sin conexión.
- **Historial**: se persiste en Supabase (`chat_historial`, una fila por persona
  con los últimos 150 mensajes de hasta 30 días; `sql/migrations/015`, **hay que
  correrla a mano**). Es best-effort (`chat-historial.service.js`): sin Supabase
  o sin la tabla el chat anda igual y el historial se pierde en cada deploy.
  Se guarda con 1,5 s de espera (junta ráfagas) y se vacía en el apagado
  ordenado (`vaciarGuardados` en `index.js`). Al restaurar se sacan los botones
  (sus confirmaciones vivían en la memoria del proceso anterior). Cada deploy
  tiene una `EPOCA`: el navegador, al verla cambiar o al reconectar el SSE,
  vuelve a pedir la conversación.
- Si cambiás un handler del bot, el chat web lo hereda solo. Si agregás un
  método de Telegram nuevo dirigido al propio usuario (ej. `sendLocation`),
  sumalo en `TelegramWeb.callApi` o la web no lo va a mostrar.

---

## Finanzas personales (segundo ámbito)

Además del cashflow del consultorio, el bot registra **finanzas personales**
(casa, viajes, nafta, supermercado) en un ámbito **separado**:

- **Almacenamiento**: pestañas propias del spreadsheet del usuario (`Personal`,
  `Viajes`, `Presupuestos`, `Preferencias`), auto-creadas. Dual-write opcional a
  Supabase vía `sql/migrations/008_movimientos_personales.sql`. **No toca `movimientos_v2`** (su CHECK
  rechaza las categorías personales y el error está silenciado).
- **Ámbito automático**: `personal-nlp.service.js` decide personal vs
  consultorio con calificadores ("luz de casa"), memoria de correcciones
  previas, y fallback a consultorio para no cambiar el comportamiento histórico.
  Siempre corregible con un botón en la confirmación.
- **Categorías propias y cerradas** (18 egreso + 4 ingreso), distintas de las
  del consultorio.
- **Quién lo usa**: depende de `PERSONAL_STORE` (`src/lib/personal-store.js`).
  `sheets` (default): solo dueño/admin, en pestañas del sheet del dueño; un invitado
  queda forzado a `consultorio`. `supabase`: **cada usuario registrado tiene el suyo**,
  privado, en tablas por `user_id` y sin Sheet (acceso solo con `forPersona`, ver
  `ARCHITECTURE.md` "Personal por persona"). Un único criterio en
  `src/auth/personal-acceso.js` (`puedeUsarPersonal`) para bot, API y dashboard.
  Los comprobantes personales de un agregado siguen yendo a consultorio.

Detalle completo en `ROADMAP_CASHY_CLINICA.md` sección 5.b.

---

## Casas compartidas (tercer ámbito)

Además de consultorio y personal, varias personas pueden compartir gastos en
una o más **casas** ("Casa", "Casa Dinamarca"): cada gasto guarda **quién pagó**
y **entre quiénes se reparte**, y se calculan saldos (quién le debe a quién).

- **Cada persona tiene su propia cuenta** (con su Personal privado); la casa es
  un espacio aparte con sus miembros. Un invitado de consultorio sin cuenta
  propia no puede ser miembro. También hay miembros **sin Telegram** (solo
  participan del reparto).
- **Datos**: pestañas `Casas`, `CasaMiembros`, `CasaMovimientos` del sheet de
  quien creó la casa; el índice de pertenencia es `profiles.casas`
  (`sql/migrations/012_casas.sql`). Sin Supabase en esta versión.
- **Acceso**: todo pasa por `casa.service.obtenerCasaParaMiembro` (perfil +
  verificación en el sheet). No usar `usuarios[]` ni `ownerOnly` para esto.
- **Bot**: `/casa` (nueva, invitar, `/unir CODIGO`, saldo, saldar...) y cargar
  con la palabra "casa": `super 45000 casa pagó Ana entre Ana y Beto`. Solo para
  quien tiene casas; sin casas nada cambia. Solo gastos; las fotos de
  comprobantes no van a casa.
- **Dashboard/API**: botón 🏡 Casa y `/api/casa/*` (acceso por membresía).
- **Monedas**: Pesos, Dólares y Euros (sin coronas danesas).

Detalle y decisiones en `ARCHITECTURE.md` ("Espacios compartidos") y
`ROADMAP_CASHY_CLINICA.md` sección 5.c.

---

## Autenticación de usuarios

**Dueño (registro directo):**
1. Usuario hace `/start`
2. Bot pide email corporativo
3. Si está en `ALLOWED_EMAILS` → validado
4. Usuario configura su propio Google Sheet
5. Queda registrado en `clientes.json` (NO commitear)
6. Máximo 3 intentos de email fallidos

**Invitado (vía `/unir CODIGO`):** el dueño genera un código con `/codigo`;
el invitado hace `/unir CODIGO` y queda agregado directo a `usuarios[]` del
dueño — **no configura ni tiene su propio sheet**, usa el del dueño. El
dueño le asigna qué puede ver/hacer ahí con permisos granulares en
`/accesos` (ver skill `bot-cashy-arquitectura`).

`ALLOWED_EMAILS` hoy vive en `.env` (cambiarlo requiere redeploy) — es un
bloqueante conocido para self-service, ver `ARCHITECTURE.md` sección 3,
Fase 1.

---

## Privacidad

- Cada **dueño** tiene su propio Google Sheet **aislado**; nadie puede ver
  el sheet de otro dueño
- Un **invitado** comparte el sheet del dueño que lo agregó — su alcance
  ahí lo define el dueño con permisos granulares (`/accesos`), no una
  separación de datos física
- `clientes.json` y `.env` están en `.gitignore`

---

## Features pendientes / roadmap

Detalle completo, priorizado y actualizado en `ROADMAP_CASHY_CLINICA.md`.
Resumen de lo más visible:

- [ ] Integración AFIP / facturación electrónica (candidato: FacturAPI)
- [ ] Consolidación de sheets multi-usuario para el admin
- [ ] Alertas automáticas de cobros pendientes
- [ ] Modelo de datos v2 (categorías, paciente/profesional como entidades)

---

## Decisiones de arquitectura

Decisiones de stack puntuales (no requieren más contexto):

- **No usar n8n**: el bot ya tiene toda la lógica implementada en código
- **Gemini para visión** en lugar de OpenAI Vision (más barato para el volumen del consultorio)
- **Sheet por usuario** (no una DB centralizada) para simplicidad de onboarding — pero ver `ARCHITECTURE.md` sección 3, esto no escala tal cual a multi-tenant
- **Bluelytics** para dólar blue argentino (no el oficial)
- **No usar PRs/branch protection por ahora**: push directo a `main`, válido mientras sea un solo desarrollador (criterio de cuándo cambiar esto en `ARCHITECTURE.md` sección 6)

Hallazgos pendientes de la última auditoría de escalabilidad/seguridad:
`AUDITORIA_2026-09-30.md` (revisarlo antes de tocar API, rate limiting o Sheets).

Decisiones de fondo (multi-tenancy, seguridad, infraestructura, modelo de
datos v2, registro de decisiones) viven en `ARCHITECTURE.md` — no se
duplican acá para que no queden desincronizadas.
