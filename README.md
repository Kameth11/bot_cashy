# bot_cashy
Bot de Telegram para gestión de cashflow y registro de movimientos en Google Sheets.

## Características

- 📝 Registro de ingresos y gastos porchat
- 📊 Reportes (balance, hoy, semana, mes)
- 💵 Soporte para Pesos y Dólares
- 🔐 Autenticación por email corporativo
- 📁 Cada usuario tiene su propio Google Sheet

## Requisitos

- Node.js 18+
- Google Cloud Project con service account
- Google Sheet compartido con la service account

## Configuración

### 1. Variables de entorno (.env)

```env
# Token del bot de Telegram (obtenelo de @BotFather)
BOT_TOKEN=tu_bot_token_aqui

# Tu USER_ID de Telegram (para ser admin)
AUTHORIZED_USER_ID=tu_telegram_user_id

# ID del tu Google Sheet (está en la URL)
SPREADSHEET_ID=1abc123def456GHI789jkl012...

# Email de la service account de Google
GOOGLE_SERVICE_ACCOUNT_EMAIL=xxx@xxx.iam.gserviceaccount.com

# Clave privada de la service account (con \n reemplazado por \\n)
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# Emails autorizados (separados por coma)
ALLOWED_EMAILS=email1@empresa.com,email2@empresa.com,email3@empresa.com

# (Opcional) Cotización default del dólar
# COTIZACION_DEFAULT=1250

# (Opcional) Modelo preferido para lectura de fotos/agendas
# Recomendado: gemini-2.5-flash
# Si priorizas costo: gemini-2.5-flash-lite
# Si priorizas precision sobre velocidad/costo: gemini-2.5-pro
# GEMINI_VISION_MODEL=gemini-2.5-flash

# (Opcional) Modelo de texto barato para lenguaje natural
# GEMINI_MODEL=gemini-2.5-flash-lite
```

### 2. Compartir el Google Sheet

Cada usuario debe compartir su sheet con la service account:

1. Abrir el Google Sheet
2. Click en "Compartir"
3. Agregar el email: `automatizaciones@gen-lang-client-0696090484.iam.gserviceaccount.com`
4. Dar permisos de **Editor**

## Cómo usar

### Runtime oficial

El runtime operativo del bot es `src/index.js`.

- Usa `npm start`
- No ejecutes `index.js` raiz: quedó como archivo legacy deshabilitado

### Iniciar el bot

```bash
npm start
```

### Comandos para el ADMIN (owner)

| Comando | Descripción |
|--------|-------------|
| `/start` | Mensaje de bienvenida |
| `/balance` | Resumen completo (hoy, semana, mes) |
| `/hoy` | Movimientos del día |
| `/pendientes` | Movimientos sin cobrar |
| `/semana` | Resumen semanal |
| `/mes` | Balance del mes |
| `/ingresos` | Lista de ingresos |
| `/egresos` | Lista de egresos |
| `/dolar` | Ver cotización actual |
| `/actualizardolar` | Actualizar cotización |
| `/ayuda` | Ver todos los comandos |

### Registrar movimientos

```bash
# Ingreso en pesos
consulta Juan Perez $15000 efectivo

# Ingreso en dólares
servicio Endodoncia U$50 transferencia

# Egreso
gasto Insumos $-500
```

### Cobrar pendiente

```bash
/cobrar ultimo
/cobrar Juan
```

### Agenda por foto

- Enviá una foto de la agenda por Telegram.
- El bot intenta extraer `hora`, `cliente`, `servicio`, `consultorio` y `profesional`.
- Si un horario no se puede leer, lo deja vacío en la agenda pero mantiene el campo horario en la estructura.

## Autenticación por Email

### Cómo funciona

1. El usuario hace `/start`
2. El sistema pide su email corporativo
3. Si el email está en `ALLOWED_EMAILS`, se verifica
4. Luego configura su propio Google Sheet
5. Queda registrado y puede usar el bot

### Agregar nuevos usuarios

Agregar sus emails al archivo `.env`:

```env
ALLOWED_EMAILS=juan@empresa.com,maria@empresa.com,carlos@empresa.com
```

Luego reiniciar el bot.

### Límite de intentos

- Máximo **3 intentos** para escribir un email autorizado
- Después de 3 intentos fallidos, debe usar `/start` de nuevo

## Estructura del Google Sheet

El sheet usa estas columnas. Si faltan, el bot las agrega automaticamente al registrar el sheet o antes de escribir nuevos movimientos.

| Fecha | Hora | Descripcion | Monto | Estado | Tipo | Moneda | MetodoPago | ID_unico | MontoPesos | ID_Origen | Categoria | Paciente | Profesional | Tratamiento | Proveedor | FechaPrestacion | FechaVencimiento | SaldoPendiente |
|-------|------|-------------|-------|--------|------|--------|-------------|----------|------------|-----------|-----------|----------|-------------|-------------|-----------|-----------------|------------------|----------------|
| Fecha | Hora | Descripción | Monto | Estado | Tipo | Moneda | Método de Pago | ID único | Monto en Pesos | ID del Origen | Categoría | Paciente | Profesional | Tratamiento | Proveedor | Fecha de prestación | Fecha de vencimiento | Saldo pendiente |

### Ejemplo de datos

| Fecha | Hora | Descripcion | Monto | Estado | Tipo | Moneda | MetodoPago | ID_unico | MontoPesos | ID_Origen | Categoria | Paciente | Profesional | Tratamiento | Proveedor | FechaPrestacion | FechaVencimiento | SaldoPendiente |
|-------|------|-------------|-------|--------|------|--------|-------------|----------|------------|-----------|-----------|----------|-------------|-------------|-----------|-----------------|------------------|----------------|
| 13/04/2026 | 10:30 | Consulta Juan Perez | 15000 | Cobrado | Ingreso | Pesos | efectivo | mov_123456 | 15000 | juan@empresa.com | consulta | Juan Perez | Dra Lopez | Consulta |  | 13/04/2026 |  | 0 |
| 13/04/2026 | 11:00 | Tratamiento Endodoncia | 50 | Cobrado | Ingreso | Dólares | transferencia | mov_123457 | 62500 | maria@empresa.com | tratamiento | Maria Gomez | Dr Perez | Endodoncia |  | 13/04/2026 |  | 0 |

### Columna ID_Origen

Esta columna identifica de dónde viene cada movimiento:
- Si el usuario se registró con email → guarda el email (ej: `juan@empresa.com`)
- Si no tiene email → guarda su Telegram User ID

Esto permite distinguir qué movimientos pertenecen a cada usuario cuando se consolidan sheets.

## Modelo de Privacidad

```
┌─────────────────────────────────────────────────────────────────┐
│ OWNER (admin)                                                │
│ ├── Sheet propio (SPREADSHEET_ID)                           │
│ └── Ve y-edita solo sus datos                               │
│                                                             │
│ USUARIO AUTORIZADO 1                                        │
│ ├── Sheet propio (configurado al registrarse)              │
│ └── NO ve el sheet del owner ni de otros usuarios           │
│                                                             │
│ USUARIO AUTORIZADO 2                                        │
│ ├── Sheet propio (configurado al registrarse)              │
│ └── NO ve el sheet del owner ni de otros usuarios           │
└─────────────────────────────────────────────────────────────────┘
```

Cada usuario:
- Configura su propio Google Sheet al registrarse
- Solo puede acceder a su propio sheet
- No puede ver ni editar los datos de otros usuarios

## Seguridad

### Variables sensibles (NO commitear)

- `.env` - Contiene tokens y claves privadas
- `clientes.json` - Datos de usuarios registrados

这些 están en `.gitignore` automáticament.

### Recomendaciones

1. **No compartir el `.env`** con nadie
2. **No pushear credenciales** al repositorio
3. **Usar emails corporativos** en `ALLOWED_EMAILS`
4. **Revisar quién tiene acceso** periódicamente

## Solución de problemas

### Error: "No se pudo acceder al sheet"

- Verificar que el sheet esté compartido con la service account
- Confirmar que el email de la service account tenga permisos de Editor

### Error: "Email no autorizado"

- Verificar que el email esté en `ALLOWED_EMAILS` (sin espacios)
- Revisar que el email sea exactamente igual (sin mayúsculas)

### Error: "Token inválido"

- Verificar que `BOT_TOKEN` sea correcto
- Obtener nuevo token de @BotFather si es necesario

## Notas

- El bot usa la API de Bluelytics para obtener cotización del dólar blue
- Los movimientos en dólares se convierten a pesos usando la cotización del día
- Cada usuario tiene su propio sheet, totalmente aislado de otros usuarios
