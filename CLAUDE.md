# bot_cashy — Contexto del Proyecto

Bot de Telegram + dashboard web para gestión de cashflow de un consultorio médico.
Registra ingresos/egresos en lenguaje natural y los guarda en Google Sheets individuales por usuario (+ Supabase opcional).

**Retomando trabajo**: leer `PLAN_BASE_DE_DATOS.md` (sección 6 "Hecho" y 6.b
"Pendiente y decisiones abiertas") y `RESPALDOS.md` antes de empezar.

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
ALLOWED_EMAILS=                   # Solo bypass de emergencia (el flujo normal usa tenant_requests)
GEMINI_VISION_MODEL=              # gemini-2.5-flash (default recomendado)
GEMINI_MODEL=                     # gemini-2.5-flash-lite (para texto barato)
COTIZACION_DEFAULT=               # Fallback si falla Bluelytics
VAPID_PUBLIC_KEY=                 # Web Push (opcional): npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY=                # idem; sin las dos no hay push, la campanita anda igual
VAPID_SUBJECT=                    # mailto:tu@email.com (o https://tu-dominio)
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
las migraciones se corren a mano, orden en `sql/README.md`; desde la 017 quedan
registradas en `schema_migrations` y CI las prueba contra un Postgres real). Plan para volverla más
sólida (RLS, trazabilidad de migraciones, fechas reales en `movimientos`,
reconciliación Sheets↔Supabase): `PLAN_BASE_DE_DATOS.md`. Respaldo diario cifrado de la
base (GitHub Actions) y cómo restaurarlo: `RESPALDOS.md`.

Esto es el modelo "legacy"/v1, fuente de verdad cuando `USE_SUPABASE=false`.
Cuando Supabase está habilitado conviven este modelo y un modelo v2
(`movimientos_v2` + `movimiento_eventos_v2`) más rico, con detección de
capacidades y mapeo automático entre ambos. Ver skill `bot-cashy-db` para el
detalle completo.

---

## Cómo trabajar / trampas conocidas

- **No se tocan los tests por ahora** (decisión del usuario).
- No se pueden probar acá Gemini, Supabase ni Google Sheets reales (no hay claves).
  Sí: handlers con un server de prueba + Playwright, y SQL contra un Postgres 16 local
  (`/usr/lib/postgresql/16/bin`, datos en `/var/lib/postgresql`, borrarlos al terminar;
  o directo `scripts/probar-sql.sh`).
- `pkill -f <patrón>` se mata a sí mismo si el patrón aparece en el propio comando.
- `dashboard/dist` está versionado: un `npm run build` lo modifica; restaurarlo con
  `git checkout -- dashboard/dist` antes de commitear. No dejar archivos sueltos de
  pruebas en la raíz. Hay que correr `npm ci` antes de `npm test` en una sesión nueva.
- **Tabla nueva = dos listas**: `SCOPED_TABLES` (`tenant-db.js`) y, si es personal, `PERSONA_TABLES`
  (`persona-db.js` y `scripts/check-tenant-isolation.js`). Faltar en una rompe en silencio la función
  entera (así dejaron de andar la campanita y el push). Checklist y cómo detectar estos errores:
  `NOTAS_2026-10-13_DIAGNOSTICO_NOTIFICACIONES_Y_PERMISOS.md`.
- Si algo "no llega" o falla en producción, **mirar primero los logs de Railway** (`severity: error`, por `scope`).

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

### Movimientos desde el dashboard: editar todo y plan de cuotas

- **Un solo formulario** (`dashboard/src/components/NuevoMovimientoModal.jsx`) sirve para crear y para
  **editar** (prop `inicial`), tanto en Movimientos como en el Dashboard. Antes la edición solo cambiaba
  descripción, monto, estado y método de pago. Ahora se edita **todo**: tipo, descripción, paciente /
  proveedor, profesional, tratamiento, moneda, monto, estado, método de pago, categoría, fecha del
  movimiento, fecha de prestación y vencimiento. `PUT /api/movimientos/:id` manda a `db.updateMovimiento`, que
  escribe en Supabase y en el Sheet (columnas en `fieldMap`, y mapeo en el wrapper de Supabase y en
  `syncRowUpdateToSheet`); respeta qué columnas existen en la base (`extendedMovimientos`/`extendedCampos`).
- **El signo del monto sigue al tipo** (egresos negativos, como al crear): editar el monto de un egreso lo
  deja negativo y cambiar el tipo da vuelta el signo del monto y del monto en pesos. "Pagado" (el estado de
  un egreso en el formulario) se guarda como "Cobrado".
- **Plan de cuotas**: al elegir categoría "Cuota" el formulario pregunta cuántas son. El monto es el **TOTAL**
  y se reparte en N movimientos (2 a 24), uno por mes, con "(cuota k/N)" en la descripción. La primera queda
  cobrada hoy (casilla "ya está cobrada") y las demás pendientes con su vencimiento; la suma es siempre el
  total exacto (la última absorbe el redondeo). Con 1 cuota es un movimiento normal. Si una cuota falla al
  guardar, se deshacen las ya creadas (nunca queda un plan a medias). Lógica en `src/utils/cuotas.js`; la vista
  previa de la pantalla (`dashboard/src/utils/cuotas.js`) es una copia: **si se cambia una, correr
  `node scripts/verificar-paridad-cuotas.mjs`**.

### Resúmenes por período en lenguaje natural

"cómo me fue ayer", "cuánto gasté el mes pasado", "resumen del año", "cuánto cobré en marzo",
"últimos 15 días", "del 01/03 al 15/03" → intent `resumen_periodo`. La IA solo identifica la
frase del período y los filtros (tipo, categoría, profesional, paciente); **las fechas las
calcula código** (`src/utils/periodo.js`) y las sumas también (`ejecutarPeriodo` en
`command.service.js`), y la respuesta siempre muestra el rango y los filtros usados.
`quick_nlp` resuelve los pedidos simples sin IA; si hay filtros que no entiende, lo deja a Gemini.
Hoy / esta semana / este mes siguen siendo `ver_hoy` / `ver_semana` / `ver_mes`.

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
| `/reconciliar` | Solo admin: compara Sheets vs Supabase (por ID, cantidad y montos por mes) y lista las escrituras dobles que fallaron. Solo lee |
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

## Notificaciones web (campanita + Web Push)

Avisos en el dashboard para quien trabaja ahí, además de los de Telegram (que siguen).
Hoy se avisa **al profesional del turno** (el registrado con `/profesional`) cuando en la
Agenda web se marca **Llegó**, se **crea**, se **cancela** o se marca **No vino** un turno; no se
le avisa a quien hizo el cambio si es el mismo profesional. Los disparan los endpoints de
`/api/agenda` (no el bot de Telegram ni la lectura de agenda por foto: no avisan todavía).

- **Servicio**: `src/services/notificaciones.service.js` (`notificar`, `notificarTurno`). Un
  aviso se guarda, se manda por SSE (evento `notificacion`, `events.service.js`) y por Web Push
  a los dispositivos suscriptos. Todo best-effort: un fallo nunca rompe la acción que lo disparó.
- **API**: `GET /api/notificaciones` (lista + `push.disponible`/`clavePublica`),
  `POST /api/notificaciones/leidas`, `POST`/`DELETE /api/notificaciones/suscripcion`.
  Rutas en `src/api/notificaciones.routes.js`. Cada persona solo ve lo suyo (el `userId` sale de la sesión).
- **Datos**: tablas `notificaciones` y `push_subscriptions` (`sql/migrations/020_notificaciones_web.sql`,
  **hay que correrla a mano**), por persona con `forPersona`. Sin la tabla, o sin Supabase, se guardan
  en memoria (se pierden en cada deploy y las suscripciones push también).
- **Diagnóstico y puesta en marcha** (un solo par VAPID para todo el servicio, iPhone, qué mirar en los
  logs, por qué no avisa a quien hizo el cambio): `NOTAS_2026-10-13_DIAGNOSTICO_NOTIFICACIONES_Y_PERMISOS.md`.
- **Push**: necesita `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` en Railway. Sin
  ellas el servidor no ofrece push (la campanita funciona igual). En iPhone solo anda con la PWA
  instalada en la pantalla de inicio (iOS 16.4+). Un dispositivo caído (404/410) se borra solo.
- **Front**: `NotificacionesContext.jsx` (estado + SSE), `CampanaNotificaciones.jsx` (en la NavBar;
  incluye el botón para activar/desactivar el push en ese dispositivo), `services/push.js`, y
  `dashboard/public/push-sw.js` (manejadores `push`/`notificationclick`, cargado por el service
  worker con `workbox.importScripts` en `vite.config.js`).
- **Registro de profesionales desde el dashboard** (equivalente web de `/profesional`): Config →
  **Profesionales** (`TabProfesionales.jsx`). Cada persona registra el suyo (nombre como figura en la
  agenda + consultorio opcional); el dueño registra o da de baja a cualquiera de sus miembros
  (él y sus invitados; los invitados aparecen tras `/codigo` + `/unir`). API en
  `src/api/profesionales.routes.js` (`GET /api/profesionales/registro`, `PUT`/`DELETE
  /api/profesionales/registro/:userId`, con `yo` para uno mismo). Escribe en la misma tabla
  `profesionales` que el bot, así que ambos caminos son intercambiables. Rechaza nombres repetidos
  (409: el aviso le llegaría a quien no es) e invalida el mapa consultorio→profesional de la lectura
  de agenda por foto (`invalidarConsultorioMap`). Ojo: en cuanto un profesional declara consultorio, ese
  mapa reemplaza al `CONSULTORIO_MAP` hardcodeado (comportamiento previo de `/profesional`). Los
  registrados también aparecen en el selector de profesional de la Agenda, y el aviso de "Llegó"
  informa por qué canal (Telegram / web) le llegó al profesional. Requiere Supabase.
- **Motivo de la consulta en la Agenda** (turno nuevo y editar): en vez de escribir el "Servicio", se
  tildan los motivos habituales (`MotivoConsulta.jsx`, lista en `dashboard/src/utils/motivos.js`) y
  "Otro…" abre un campo para escribir uno distinto. Se guarda igual que siempre, en el campo `servicio`
  como texto separado por coma (`"Control, Urgencia, Prótesis parcial"`), así que el bot, los reportes y
  los turnos viejos no cambian; un texto viejo que no coincide con la lista cae en "Otro…". Pendiente a
  propósito: que lo que se repite en "Otro…" se pueda guardar como opción propia del consultorio.
- **Para agregar un aviso nuevo**: sumar el tipo en `TIPOS` y su texto en `TEXTOS_TURNO`
  (`notificaciones.service.js`) y llamar a `notificar`/`notificarTurno` sin `await` desde el endpoint.

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
- **Quién lo usa**: depende de `PERSONAL_STORE` (`src/lib/personal-store.js`). **En
  producción está en `supabase`** (con `USE_SUPABASE=true`): **cada usuario registrado tiene
  el suyo**, privado, en tablas por `user_id` y sin Sheet (acceso solo con `forPersona`, ver
  `ARCHITECTURE.md` "Personal por persona"). `sheets` es el modo anterior y solo queda como
  respaldo del código si falta la variable (el valor del código sin env es `sheets`): solo
  dueño/admin, en pestañas del sheet del dueño; un invitado queda forzado a `consultorio`.
  Un único criterio en
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
3. Si el email tiene una solicitud aprobada en la tabla `tenant_requests`
   (Supabase) → validado. Si no existe, se crea una solicitud `pending`.
4. El admin aprueba/rechaza con `/aprobar`, `/rechazar`, `/solicitudes` o
   desde Config en el dashboard (sin redeploy)
5. Usuario configura su propio Google Sheet
6. Queda registrado en `clientes.json` (NO commitear)
7. Máximo 3 intentos de email fallidos

**Invitado (vía `/unir CODIGO`):** el dueño genera un código con `/codigo`;
el invitado hace `/unir CODIGO` y queda agregado directo a `usuarios[]` del
dueño — **no configura ni tiene su propio sheet**, usa el del dueño. El
dueño le asigna qué puede ver/hacer ahí con permisos granulares en
`/accesos` (ver skill `bot-cashy-arquitectura`).

`ALLOWED_EMAILS` (`.env`) quedó solo como bypass de emergencia: si el email
está ahí se aprueba directo sin pasar por `tenant_requests`. Fase 1 de
`ARCHITECTURE.md` sección 3 ya está implementada.

**Invitado por email, sin Telegram (invitaciones web):** quien tenga el permiso **`invitar_personas`**
invita desde Config → **Invitar** escribiendo un Gmail, eligiendo permisos (y, si quiere, nombre y
consultorio como profesional). La persona entra al dashboard con **"Entrar con Google"** usando ese
email y la cuenta se crea sola: invitado del dueño (mismo Sheet) con los permisos elegidos y un **ID
propio negativo** (no choca con los de Telegram, que son positivos). Sin invitación pendiente para ese
email, un Gmail cualquiera NO entra (sigue el vínculo por el bot de siempre).
- **Quién puede invitar lo decide el dueño**: `invitar_personas` es un permiso más, que se asigna en
  Config → Accesos. Por defecto solo el dueño; ningún preset lo incluye.
- **Reglas** (`src/services/invitacion-web.service.js`, probadas en `tests/invitacion-web.service.test.js`):
  solo se dan permisos que quien invita tiene (sin escalar privilegio); `invitar_personas` solo lo
  da el dueño (no se encadena); una invitación vale 7 días, se usa una vez (UPDATE condicional, sin
  carreras), se puede revocar (quien la creó o el dueño) y hay un tope de 25 pendientes por consultorio.
- **Datos**: tabla `invitaciones_web` (`sql/migrations/021_invitaciones_web.sql`, **hay que correrla a
  mano**). Es GLOBAL con `tenant_id` explícito (se busca por email al entrar, cuando aún no se sabe el
  consultorio): el servicio filtra por tenant en todo lo que lista, crea o revoca. Requiere Supabase y
  `GOOGLE_CLIENT_ID`.
- **API**: `GET`/`POST /api/invitaciones`, `DELETE /api/invitaciones/:id`
  (`src/api/invitaciones.routes.js`); el canje vive en `POST /api/auth/google`.
- **Vincular Telegram después**: en Config → General, una cuenta web ve "Vincular Telegram". Abre
  `t.me/<bot>?start=vincular_<token>` (token de un solo uso, 10 min, en memoria:
  `vinculo-telegram.service.js`); en el bot confirma viendo el email de la cuenta
  (`handlers/vinculo-telegram.js`) y ESE Telegram queda en `profiles.telegram_id`
  (`sql/migrations/022_profiles_telegram_id.sql`, **hay que correrla a mano**; sin ella el botón avisa).
  Desde ahí el middleware del bot (`handlers/middleware.js`) reemplaza `ctx.from.id` por el ID de la
  cuenta (el real queda en `ctx.state.telegramId`), así que todo el bot trata a ese Telegram como la
  cuenta. **Regla para código nuevo**: todo `bot.telegram.sendMessage(<ID de una persona>)` pasa por
  `chatIdDe()` (`src/lib/telegram-destino.js`): un ID negativo sin Telegram no tiene chat (devuelve null).
  Un Telegram que ya tiene cuenta propia (dueño, invitado de otro) NO se puede vincular a otra.
- **Limitaciones**: estas cuentas no usan el bot hasta vincular Telegram (sí agenda, chat web, campanita
  y push). El login con código de 6 dígitos no vale para ellas (usan Google o "Entrar con Telegram").
  No hay todavía "quitar miembro" desde el dashboard ni fusión de dos cuentas de la misma persona.

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
- [ ] Modelo de datos v2 completo en producción (`movimientos_v2` y eventos
      siguen siendo draft; hoy hay categorías de egresos, profesionales y
      reportes `/deudores`, `/por_profesional`, `/cobros_por_metodo`)
- [ ] JWT del dashboard en cookie httpOnly (la duración ya es 14d por defecto,
      configurable con `SESSION_DURATION_DAYS`; falta mover el token a cookie)
- [ ] Redis para write-lock (escalado horizontal; hoy una sola instancia)
- [ ] Onboarding automático del Sheet (Fase 3) y billing (Fase 4)
- [ ] QA manual end-to-end en Telegram real

Ya hecho: multi-tenancy Fase 2 (`tenant_id` + `forTenant`), `tenant_requests`,
permisos granulares, PWA, reportes de gestión.

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
