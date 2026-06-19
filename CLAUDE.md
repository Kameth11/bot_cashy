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

- **Runtime**: Node.js 18+
- **Bot**: Telegraf (Telegram)
- **Storage**: Google Sheets por usuario (service account)
- **AI Vision**: Gemini (lectura de fotos de agenda)
- **Dólar**: API Bluelytics (cotización blue)
- **Tests**: Jest
- **Entry point**: `src/index.js` (NO usar `index.js` raíz, está deprecado)

---

## Estructura

```
bot_cashy/
├── src/           # Código principal — entry point: src/index.js
│   ├── handlers/  # Comandos (commands/), texto, fotos, callbacks NLP
│   ├── services/  # Lógica de negocio (db, sheet, gemini, quick_nlp, etc.)
│   ├── lib/       # Clientes externos (telegraf, google, supabase)
│   ├── auth/      # Autenticación / autorización de usuarios
│   ├── state/     # TTLMaps de estados conversacionales pendientes
│   ├── utils/     # Helpers (formatter, validation, sheet-row, movimiento-v2)
│   └── config/    # Variables de entorno centralizadas
├── dashboard/     # Dashboard web (React + Vite) — Inicio, Movimientos, Agenda, Config
├── scripts/       # Scripts auxiliares
├── sql/           # Migraciones / queries SQL (schema v1 y v2)
├── tests/         # Tests Jest
├── .github/workflows/ci.yml  # CI: tests + build en cada push, notifica a Discord
├── index.js       # LEGACY — no usar
├── jest.config.js
└── package.json
```

El dashboard se sirve desde el mismo proceso/servicio que el bot (Express
sirve el build estático de `dashboard/dist`). Tiene su propia API (`src/api/`)
montada en el mismo `src/index.js`. Auth del dashboard: código de Telegram +
JWT (180 días hoy — ver `ARCHITECTURE.md` sección 4 para por qué eso está
marcado como mejora pendiente).

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

## Comandos

```bash
npm start          # Inicia el bot (usa src/index.js)
npm test           # Corre los tests con Jest
```

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

---

## Autenticación de usuarios

1. Usuario hace `/start`
2. Bot pide email corporativo
3. Si está en `ALLOWED_EMAILS` → validado
4. Usuario configura su propio Google Sheet
5. Queda registrado en `clientes.json` (NO commitear)
6. Máximo 3 intentos de email fallidos

`ALLOWED_EMAILS` hoy vive en `.env` (cambiarlo requiere redeploy) — es un
bloqueante conocido para self-service, ver `ARCHITECTURE.md` sección 3,
Fase 1.

---

## Privacidad

- Cada usuario tiene su propio Google Sheet **aislado**
- Nadie puede ver el sheet de otro usuario
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

Decisiones de fondo (multi-tenancy, seguridad, infraestructura, modelo de
datos v2, registro de decisiones) viven en `ARCHITECTURE.md` — no se
duplican acá para que no queden desincronizadas.
