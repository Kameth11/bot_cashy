# Plan — Lectura de comprobantes (facturas, tickets, transferencias)

Estado: **aprobado para empezar** (2026-09-30). Decisiones tomadas con el
usuario al final de este documento.

## Objetivo

Que el consultorio pueda mandar una **foto o PDF** de un comprobante (por
Telegram o subiéndolo desde el dashboard) y el bot:

1. Detecte solo qué es: agenda (flujo actual), factura/ticket de gasto, o
   comprobante de transferencia de un paciente.
2. Lea los datos con Gemini Vision.
3. Muestre una confirmación editable (la misma de la carga por texto) y
   guarde el movimiento en el ámbito correcto (consultorio o personal).
4. Guarde el comprobante (datos fiscales, ítems y, si hay Supabase, el
   archivo) vinculado al movimiento, y avise si ya estaba cargado.

## Flujo

```
foto / PDF (Telegram o dashboard)
  → permiso: tiene que tener editar_agenda o cargar_movimientos
  → hash SHA-256 del archivo → ¿ya se cargó este mismo archivo? → aviso
  → clasificar (Gemini flash-lite, imagen chica, ~1 llamada barata)
      agenda          → flujo actual de agenda (exige editar_agenda)
      factura/ticket  → extraer comprobante (exige cargar_movimientos)
      transferencia   → extraer transferencia (exige cargar_movimientos)
      otro / duda     → botones: 📅 Agenda · 🧾 Gasto · 💸 Cobro · ❌
  → extraer datos (Gemini Vision, prompt específico por tipo)
  → ¿duplicado por (CUIT|emisor, número, total)? → aviso con opción de seguir
  → armar `entities` igual que registrar_movimiento del NLP
  → mostrarConfirmacion() de nlp-confirm.js (editar campos, cambiar ámbito)
  → guardar movimiento (consultorio: guardarMovimiento / personal: personal.service)
  → registrar comprobante (pestaña Comprobantes + Supabase si está) con
    ID del movimiento; ReferenciaId del movimiento = "comp:<ID_Comprobante>"
```

### Factura / ticket de gasto

- Campos: emisor (proveedor), CUIT, tipo (A/B/C/ticket/recibo), número,
  fecha de emisión, fecha de vencimiento, total, moneda, ítems
  `[{descripcion, cantidad, precioUnitario, subtotal}]`, categoría sugerida
  (de las categorías de egreso existentes del consultorio: insumos,
  alquiler, servicios, impuestos, mantenimiento, software, honorarios…).
- **Pagada o no**: si tiene vencimiento futuro o dice "a pagar"/"saldo" →
  egreso `Pendiente` + `FechaVencimiento`; si es ticket/recibo o dice
  "pagado" → `Cobrado`. Se puede cambiar en la confirmación.
- **Ámbito**: se usa la misma detección que el texto
  (`personal-nlp.service`): súper/nafta/farmacia de uso personal → Personal
  (solo dueño/admin; para invitados siempre consultorio). Botón para
  cambiarlo, como hoy.

### Transferencia de un paciente

- Campos: quién pagó (nombre, CUIT/CUIL si figura), monto, fecha,
  banco/billetera, número de operación.
- Busca pendientes de ese pagador con `buscarCandidatosCobrar` (misma
  lógica de `/cobrar`):
  - 1 pendiente → "¿Cobro el pendiente de Juan ($30.000)?" (si el monto es
    menor, cobro parcial con `ejecutarCobrarFila`).
  - varios → lista para elegir, igual que `/cobrar`.
  - ninguno → ingreso nuevo `Cobrado` por transferencia.
- Duplicado por número de operación.

### PDFs

- Telegram: nuevo `bot.on('document')` para `application/pdf` e imágenes
  mandadas "como archivo" (sin compresión). Límite de tamaño configurable.
- Gemini recibe el PDF directo (`inlineData` con `application/pdf`), sin
  preprocesar con sharp.

## Modelo de datos

**Pestaña `Comprobantes`** (auto-creada en el sheet del dueño, como
`Personal`):

`ID_Comprobante | FechaCarga | Tipo | Ambito | Emisor | CUIT | TipoComprobante | Numero | FechaEmision | FechaVencimiento | Total | Moneda | Hash | Archivo | MimeType | ID_Movimiento | Items | CargadoPor`

- `Items`: JSON (el detalle completo; el movimiento guarda solo el total).
- `Archivo`: `sb:<path>` (Supabase Storage) o `tg:<file_id>` (Telegram, ver
  abajo) o vacío.

**Supabase** (si `USE_SUPABASE=true`), migración `011_comprobantes.sql`:

- `comprobantes` (mismos campos + `tenant_id`, `movimiento_id`) y
  `comprobante_items`. Índices únicos para duplicados:
  `(tenant_id, hash)` y `(tenant_id, cuit, numero, total)`.
- Todo acceso por `forTenant()` (lo exige `npm run check:tenant`).
- Bucket privado `comprobantes`, path `<tenant_id>/<AAAA-MM>/<ID>.<ext>`.

## Guardado del archivo

Como no está confirmado que producción tenga Supabase:

1. **Con Supabase** → se sube al bucket privado; el dashboard lo ve con un
   link firmado que vence (60 s) vía `GET /api/comprobantes/:id/archivo`.
2. **Sin Supabase, cargado por Telegram** → se guarda el `file_id` de
   Telegram (es permanente para el bot) y el mismo endpoint lo descarga por
   la API de Telegram y lo sirve. Sin costo extra.
3. **Sin Supabase, subido desde el dashboard** → el bot manda el archivo al
   Telegram de quien lo subió ("📎 Comprobante guardado") y guarda ese
   `file_id`. Así el caso 2 cubre todo.

Si no se puede guardar el archivo, el movimiento y los datos se guardan
igual (nunca se pierde la carga por el archivo).

## Permisos

- Cargar comprobante (bot o dashboard) = `cargar_movimientos`.
- Foto de agenda sigue siendo `editar_agenda`. El chequeo fino pasa a
  después de clasificar; antes solo se exige tener alguno de los dos (para
  no gastar Gemini en quien no puede ninguna).
- Ver comprobantes/archivos = `ver_movimientos`. Comprobantes personales:
  solo dueño/admin (`ownerOnly`), como todo Personal.

## Dashboard

- **Movimientos**: ícono 📎 en los que tienen comprobante → abre el archivo
  y el detalle (emisor, CUIT, número, ítems).
- **Subir comprobante**: botón en Movimientos (y en Personal para el
  dueño) → `POST /api/comprobantes/leer` (multipart, mismo límite de
  tamaño) → devuelve lo extraído + duplicados → modal de confirmación
  editable (reusa `NuevoMovimientoModal`/`NuevoPersonalModal` precargados)
  → `POST /api/comprobantes` guarda movimiento + comprobante.

## Fases

| Fase | Contenido | Estimado |
|---|---|---|
| 1 ✅ | Clasificación + factura/ticket por foto y PDF en Telegram, confirmación, pendiente/vencimiento, ámbito personal, permisos, pestaña Comprobantes, duplicados, tests | 2–2,5 días |
| 2 ✅ | Transferencias de pacientes + match con pendientes (2026-09-30: `extraerTransferencia`, `buscarPendientesDePagador`, botones cobrar/ingreso nuevo/cancelar, cobro parcial; duplicados por hash o CUIT/nombre + n° de operación + monto) | 1 día |
| 3 | Archivo (Supabase Storage / file_id de Telegram) + migración 011 + ver 📎 en el dashboard | 1,5 días |
| 4 | Subir comprobante desde el dashboard | 1,5 días |
| 5 | Ítems: guardado en `comprobante_items` y vista de detalle | 1 día |

Total ≈ 7–8 días de trabajo. Cada fase se sube a `main` por separado con
CI en verde.

## Costo de IA

Por comprobante: 1 clasificación (flash-lite, imagen reducida) + 1
extracción (flash). Del orden de centavos de dólar cada 100 comprobantes;
las fotos de agenda suman solo la clasificación. Todo bajo
`geminiMediaSemaphore`.

## Decisiones (2026-09-30)

- Alcance v1: facturas/tickets de gastos, transferencias de pacientes,
  tickets personales, PDFs además de fotos.
- Detección: automática con IA; si duda, pregunta con botones.
- Archivo: Supabase Storage (con fallback a `file_id` de Telegram porque no
  está confirmado que prod tenga `USE_SUPABASE=true`).
- Facturas impagas: egreso `Pendiente` + `FechaVencimiento`.
- Transferencias: buscar pendiente del paciente y ofrecer cobrarlo.
- Permisos: los mismos que cargar/ver movimientos; personal solo dueño.
- Extras v1: detección de duplicados, ver comprobante en el dashboard,
  subir desde el dashboard, ítems por factura.

## Ideas para más adelante

- **Transferencias entre cuentas propias** (2026-09-30): mover plata entre tus
  propias cuentas no es ingreso ni gasto. Hoy una foto así se carga como un
  ingreso (o un gasto, si se cambia el tipo a mano). Se decidió no resolverlo
  ahora porque no debería ser un caso común; si empieza a serlo, agregar una
  sección/tipo "Transferencia propia" que no sume a ingresos ni a egresos.
