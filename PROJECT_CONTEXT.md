# bot_cashy — Project Context (Universal)

> Este archivo es para dar contexto a cualquier asistente de IA (Claude, GPT, Gemini, Cursor, Copilot, OpenCode, etc.).
> Pegalo al inicio de cualquier conversación o agrégalo como contexto del proyecto.

---

## ¿Qué es este proyecto?

**bot_cashy** es un bot de Telegram + dashboard web para gestión de cashflow y agenda de un consultorio médico argentino.
Permite registrar ingresos y egresos en lenguaje natural desde Telegram, guardándolos en Google Sheets (siempre) y opcionalmente en Supabase. El dashboard web permite además ver, filtrar, editar y cobrar desde el navegador.
Está pensado para uso interno de un equipo pequeño (médicos/administrativos), no para el público general.

**Repo**: https://github.com/Kameth11/bot_cashy

---

## Stack técnico

- **Lenguaje**: JavaScript (Node.js 18+), sin TypeScript
- **Bot**: Telegraf (wrapper de la API de Telegram)
- **Storage**: Google Sheets via service account (una sheet por usuario)
- **AI Vision**: Google Gemini (para leer fotos de agenda)
- **Dólar blue**: API de Bluelytics (`api.bluelytics.com.ar`)
- **Tests**: Jest
- **Entry point**: `src/index.js` ← SIEMPRE este (no `index.js` raíz, está deprecado)

---

## Estructura del proyecto

```
bot_cashy/
├── src/           # Todo el código activo
│   └── index.js   # Entry point principal
├── scripts/       # Scripts auxiliares (setup, migraciones, etc.)
├── sql/           # Queries SQL / migraciones
├── tests/         # Tests Jest
├── index.js       # LEGACY — ignorar, no usar
├── .env           # Credenciales (nunca commitear)
├── clientes.json  # Usuarios registrados (nunca commitear)
├── ROADMAP_CASHY_CLINICA.md    # Roadmap + spec funcional unificados (antes
│                                # estaban en archivos separados: BOT_MVP_V2_SPEC.md
│                                # tenía la spec del modelo v2, README_REFACTOR.md /
│                                # README_REFACTOR_SDD.md el plan de migración legacy
│                                # → src/, y QA_SPEC7_CHECKLIST.md el checklist de QA
│                                # de esa migración. Esos 4 archivos se fusionaron
│                                # acá y se borraron — el detalle completo de cada
│                                # uno sigue en el historial de git si hace falta)
└── package.json
```

---

## Variables de entorno

```env
BOT_TOKEN=                        # Token del bot (de @BotFather en Telegram)
AUTHORIZED_USER_ID=               # Telegram User ID del administrador
SPREADSHEET_ID=                   # ID del Google Sheet del admin
GOOGLE_SERVICE_ACCOUNT_EMAIL=     # Email de la service account de Google Cloud
GOOGLE_PRIVATE_KEY=               # Clave privada (los \n deben estar escapados como \\n)
ALLOWED_EMAILS=email1@x.com,email2@x.com   # Emails autorizados, separados por coma

# Opcionales
GEMINI_VISION_MODEL=gemini-2.5-flash       # Para leer fotos (más preciso)
GEMINI_MODEL=gemini-2.5-flash-lite         # Para texto (más barato)
COTIZACION_DEFAULT=1250                    # Fallback si falla Bluelytics
```

---

## Modelo de datos (columnas del Google Sheet)

| Columna | Descripción |
|---|---|
| Fecha | Fecha del movimiento |
| Hora | Hora del movimiento |
| Descripcion | Texto libre |
| Monto | Número (negativo = egreso) |
| Estado | `Cobrado`, `Pendiente`, `Pagado`, `Rechazado` o `Presentado OS` |
| Tipo | `Ingreso` o `Egreso` |
| Moneda | `Pesos` o `Dólares` |
| MetodoPago | `efectivo`, `transferencia`, etc. |
| ID_Unico | ID generado por el bot |
| MontoPesos | Conversión automática a pesos |
| ID_Origen | Email del usuario (o Telegram ID) |
| Categoria | Clasificación del movimiento |
| Paciente | Nombre del paciente |
| Pagador | Quién pagó, si difiere del paciente |
| Profesional | Nombre del profesional |
| Tratamiento | Tipo de tratamiento |
| Proveedor | Para egresos a proveedores |
| FechaPrestacion | Fecha en que se realizó el servicio |
| FechaVencimiento | Para pagos diferidos |
| SaldoPendiente | Monto todavía no cobrado |
| ReferenciaId | Vínculo con otro movimiento (ej. turno de agenda cobrado) |

---

## Cómo registrar movimientos (lenguaje natural)

```
# Ingreso en pesos
consulta Juan Perez $15000 efectivo

# Ingreso en dólares
servicio Endodoncia U$50 transferencia

# Egreso
gasto Insumos $-500

# Cobrar un pendiente
/cobrar ultimo
/cobrar Juan
```

---

## Comandos del bot

```
/start          → Bienvenida / registro
/balance        → Resumen completo
/hoy            → Movimientos del día
/pendientes     → Sin cobrar
/semana         → Resumen semanal
/mes            → Balance del mes
/ingresos       → Lista de ingresos
/egresos        → Lista de egresos
/dolar          → Cotización actual
/actualizardolar→ Actualizar cotización
/cobrar [nombre] [monto?] → Cobrar pendiente (total o parcial)
/editar / /eliminar → Editar o eliminar un movimiento
/listar         → Últimos movimientos
/debug          → Diagnóstico interno
/limpiar        → Limpiar filas inválidas
/regenerar_ids  → Regenerar ID_Unico faltantes
/codigo / /unir → Generar y usar código de invitación
/misusuarios    → Listar usuarios invitados (admin)
/reiniciar      → Borrar registro propio
/sheet          → Link al Google Sheet propio
/cancelar       → Cortar un flujo pendiente
/ayuda / /help  → Todos los comandos
```

(lista completa y al día en `CASHY_CONTEXT.md`, sección "Comandos existentes del bot")

---

## Flujo de autenticación de usuarios

1. Usuario escribe `/start`
2. Bot pide email corporativo
3. Si el email está en `ALLOWED_EMAILS` → acceso concedido
4. Usuario pega el ID de su Google Sheet
5. Bot verifica acceso al sheet
6. Usuario queda registrado en `clientes.json`
7. Máximo 3 intentos fallidos de email → bloqueo hasta nuevo `/start`

---

## Privacidad y aislamiento

- Cada usuario accede **solo** a su propio Google Sheet
- Nadie puede ver ni editar los datos de otro usuario
- El admin tiene su sheet propio también
- `clientes.json` y `.env` están en `.gitignore`

---

## Reglas del dominio (consultorio médico argentino)

- **Dólar blue**: cotización paralela informal, no la oficial del BCRA
- **Montos negativos**: egresos (gastos del consultorio)
- **Pendiente**: servicio prestado pero no cobrado aún
- **FechaPrestacion ≠ Fecha**: el turno puede ser hoy pero el cobro es después
- **Multi-profesional**: el consultorio tiene más de un médico

---

## Lo que NO está implementado aún

- AFIP / facturación electrónica (pendiente, candidato: FacturAPI)
- Vista consolidada para el admin de todos los usuarios
- Alertas automáticas de cobros pendientes
- Modelo de datos v2 (categorías/entidades estructuradas — ver `ROADMAP_CASHY_CLINICA.md`)

**Ya implementado (corrección):** el dashboard web existe y está en uso
activo — no es un placeholder ni algo pendiente. Tiene Inicio, Movimientos,
Agenda y Config, con edición/cobro/borrado y tiempo real.

---

## Decisiones de arquitectura tomadas

| Decisión | Razón |
|---|---|
| Google Sheets (no DB) | Cero infraestructura, el cliente ya lo usa |
| Sheet por usuario (no una sola) | Privacidad y onboarding simple |
| Gemini (no OpenAI) | Más barato para el volumen del consultorio |
| Bluelytics para dólar | Es la API más usada en Argentina para el blue |
| No n8n | El bot ya tiene toda la lógica; n8n sería complejidad sin ganancia |

---

## Comandos frecuentes de desarrollo

```bash
npm start     # Iniciar el bot
npm test      # Correr tests Jest
```

---

## Contexto para el asistente

- El proyecto está en **desarrollo activo** por un desarrollador intermedio
- El cliente es un **consultorio médico pequeño en Argentina**
- El código está en **español e inglés mezclado** (logs en español, código en inglés)
- Priorizar **simplicidad** sobre elegancia: es un MVP funcional
- Si sugerís nuevas dependencias, preferir las que ya están en el proyecto o las nativas de Node
- El entorno de producción es **Railway** (bot + API + dashboard estático en un solo servicio, con CI en GitHub Actions corriendo en cada push)
