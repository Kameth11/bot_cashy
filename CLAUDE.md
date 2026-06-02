# bot_cashy — Contexto del Proyecto

Bot de Telegram para gestión de cashflow de un consultorio médico.
Registra ingresos/egresos en lenguaje natural y los guarda en Google Sheets individuales por usuario.

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
├── scripts/       # Scripts auxiliares
├── sql/           # Migraciones / queries SQL
├── tests/         # Tests Jest
├── index.js       # LEGACY — no usar
├── jest.config.js
└── package.json
```

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

Columnas del sheet por usuario:
`Fecha | Hora | Descripcion | Monto | Estado | Tipo | Moneda | MetodoPago | ID_unico | MontoPesos | ID_Origen | Categoria | Paciente | Profesional | Tratamiento | Proveedor | FechaPrestacion | FechaVencimiento | SaldoPendiente`

- **Moneda**: `Pesos` o `Dólares`
- **Estado**: `Cobrado` o `Pendiente`
- **Tipo**: `Ingreso` o `Egreso`
- **ID_Origen**: email del usuario (o Telegram ID si no tiene email)
- Los montos en dólares se convierten a pesos usando cotización del día

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

---

## Privacidad

- Cada usuario tiene su propio Google Sheet **aislado**
- Nadie puede ver el sheet de otro usuario
- `clientes.json` y `.env` están en `.gitignore`

---

## Features pendientes / roadmap

- [ ] Integración AFIP / facturación electrónica (candidato: FacturAPI)
- [ ] Consolidación de sheets multi-usuario para el admin
- [ ] Alertas automáticas de cobros pendientes

---

## Decisiones de arquitectura

- **No usar n8n**: el bot ya tiene toda la lógica implementada en código
- **Gemini para visión** en lugar de OpenAI Vision (más barato para el volumen del consultorio)
- **Sheet por usuario** (no una DB centralizada) para simplicidad de onboarding
- **Bluelytics** para dólar blue argentino (no el oficial)
