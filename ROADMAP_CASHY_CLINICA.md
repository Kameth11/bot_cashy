# Roadmap y Specs — Cashy (documento unificado)

> Este archivo unifica lo que antes estaba repartido en `ROADMAP_CASHY_CLINICA.md`,
> `BOT_MVP_V2_SPEC.md`, `README_REFACTOR.md`, `README_REFACTOR_SDD.md` y
> `QA_SPEC7_CHECKLIST.md`. Esos 5 archivos se borraron tras esta unificación;
> su contenido sigue disponible en el historial de git si hace falta el detalle
> completo de alguna fase. `CASHY_CONTEXT.md` y `PROJECT_CONTEXT.md` quedaron
> fuera de esta limpieza a propósito (son archivos de memoria/contexto para
> asistentes de IA, no roadmaps — esa función hoy la cumple `CLAUDE.md`).

## Objetivo de este documento

Dejar documentado qué tiene hoy `bot_cashy`, qué le falta para ser un sistema
de cashflow de consultorio/clínica completo, y en qué orden conviene
construirlo. Es un documento vivo — se actualiza a medida que se cierran
etapas, no hace falta abrir uno nuevo por cada feature.

---

## 1. Estado actual (verificado contra el código, no solo contra el plan)

### Ya funciona

- Registro de movimientos por Telegram en lenguaje natural: ingresos, egresos,
  pendientes, cobros parciales, pesos/dólares/euros, método de pago.
- Reportes: `/balance`, `/hoy`, `/semana`, `/mes`, `/ingresos`, `/egresos`,
  `/pendientes`, `/listar`.
- Lectura de agenda por foto (Gemini Vision): extrae consultorio, profesional,
  hora, cliente, servicio, estado.
- **Agenda conectada a caja**: cobrar un turno desde el dashboard genera un
  movimiento automáticamente (esto corrige al documento original, que decía
  que agenda y caja estaban desconectadas — ya no es así).
- **Dashboard web completo** (Inicio, Movimientos, Agenda, Config), con
  tiempo real (SSE), filtros, edición/borrado inline, mobile-friendly. El
  documento original recomendaba no priorizar la web — quedó superado, la web
  ya existe y se usa activamente.
- Seguridad: logger centralizado con redacción de secretos, `JWT_SECRET`
  obligatorio, rate limiting de login, auditoría de eventos sensibles, mutex
  de escritura por usuario (evita race conditions Sheets/Supabase), CI con
  tests + build en cada push y notificación a Discord.
- Storage: Google Sheets por usuario (modelo v1, siempre activo) + Supabase
  opcional (`USE_SUPABASE=true`) como dual-write/backend más robusto.
- Migración legacy `index.js` → `src/`: **completa**. El entrypoint oficial es
  `src/index.js`, no queda dependencia operativa del monolito legacy. El plan
  de refactor fase-por-fase que existía en archivos separados ya cumplió su
  función y se resume en la sección 7.

### Todavía no alcanza para

- Sistema de cashflow clínico completo (seguimiento de obras sociales/
  prepagas, tablero financiero con proyecciones, gestión por profesional,
  deuda con trazabilidad de vencimientos).
- El modelo de datos sigue siendo "movimiento genérico": no hay campos propios
  para paciente/profesional/proveedor/obra social/tratamiento como entidades
  — todo termina en `descripcion` libre.
- No se puede distinguir fecha de prestación vs. fecha de cobro real vs.
  fecha de vencimiento (crítico para obras sociales que pagan a 45-90 días).
- Reportes por profesional, por método de cobro, presupuesto vs. real,
  proyección 30/60/90 días: no existen.

---

## 2. Brecha contra la necesidad real de un consultorio/clínica

| Área | Estado | Qué falta |
|---|---|---|
| Cobros a pacientes | Parcial bueno | Paciente como campo propio (no en descripción); distinguir anticipo/seña/cuota/saldo final; vincular cobros a un mismo tratamiento |
| Cobros de obras sociales/prepagas | No real | OS, fecha de prestación/presentación/acreditación estimada y real, lote/liquidación, estado de cobro por OS |
| Planes de pago / cuotas | Parcial débil | Cuota 1/2/3, vencimientos por cuota, historial de pagos parciales, saldo consolidado por paciente |
| Anticipos y señas | Parcial débil | Categoría específica, relación con el tratamiento posterior |
| Egresos | Parcial bueno para operar, insuficiente para gestionar | Categoría/subcategoría dura, proveedor, profesional asociado, vencimiento, periodicidad |
| Pacientes con saldo pendiente | Básico, sí | Saldo consolidado, historial, vencimiento, alertas de mora |
| Facturas de proveedores a pagar | No | Proveedor, vencimiento, estado de pago, alertas |
| Vencimientos de obras sociales | No | No hay seguimiento de fechas esperadas ni atrasos |
| Lógica temporal | Insuficiente | Solo existe fecha/hora de carga — falta prestación, presentación, vencimiento, cobro estimado/real |
| Reportes por forma de cobro / profesional | No | El dato existe (`metodoPago`) pero no hay reporte dedicado; `profesional` existe en agenda, no en movimiento financiero |
| Presupuesto vs. real / proyección 30-60-90 / alertas de saldo mínimo | No | No existen estas entidades en el modelo |

**Riesgo de modelo actual a tener en cuenta:** existe `montoPesos` pero buena
parte de los reportes siguen usando `monto` crudo — antes de cualquier
dashboard de gestión serio hay que unificar el criterio (siempre reportar en
pesos consolidados).

---

## 3. Roadmap recomendado (etapas de negocio)

Ninguna de las etapas 0-5 está realmente empezada — son decisiones de
modelado de negocio que el usuario tiene que cerrar primero (no es algo que
se pueda planificar técnicamente sin esas respuestas). La etapa 6 (web) ya
está hecha y superada.

| Etapa | Objetivo | Estado |
|---|---|---|
| 0 — Definición funcional | Cerrar categorías de ingresos/egresos, entidades de negocio (paciente/profesional/proveedor/obra social), si el foco es consultorio simple o clínica multi-profesional, si OS entra en el MVP | No iniciada |
| 1 — Normalizar el movimiento financiero | Pasar de texto libre a campos estructurados (ver spec del modelo v2, sección 4) | Parcial — existe el schema draft en Supabase (`movimientos_v2`), el bot sigue escribiendo en v1 |
| 2 — Temporalidad real | `fecha_prestacion`, `fecha_presentacion`, `fecha_vencimiento`, `fecha_cobro_estimada/real` | Parcial — `fechaPrestacion`/`fechaVencimiento` existen como columnas pero sin reportes/alertas que las usen |
| 3 — Cuentas por cobrar y pagar | Saldo trazable por paciente/proveedor, eventos de pago en vez de sobrescribir saldo | No iniciada |
| 4 — Reportes de gestión | Por profesional, por método, por OS, presupuesto vs. real, proyección 30/60/90 | No iniciada (solo hay agregados simples: balance/hoy/semana/mes) |
| 5 — Configuración y alertas | Saldo mínimo, alertas de vencimiento/mora/OS sin acreditar | No iniciada |
| 6 — Web MVP | Dashboard de lectura mínimo | **Hecha y superada** — el dashboard actual permite editar/cobrar/eliminar, no solo leer |

**Orden de prioridad sugerido:** definir alcance funcional → rediseñar modelo
de datos → mejorar carga vía Telegram → mejorar reportes → (la web ya está,
así que este último paso ya no aplica como estaba escrito originalmente).

### Primer backlog propuesto (de negocio)

1. Definir categorías de ingresos y egresos.
2. Definir entidades: paciente, profesional, proveedor, obra social.
3. Definir fechas necesarias por tipo de movimiento.
4. Definir cómo se modela cuota/anticipo/seña/saldo.
5. Actualizar schema de Supabase.
6. Actualizar columnas del Sheet o estrategia de compatibilidad.
7. Adaptar parser y comandos del bot.
8. Agregar reportes nuevos.

---

## 4. Spec del modelo de datos v2 (decisiones ya cerradas)

Esto es más específico y está más resuelto que la sección 3 — son decisiones
concretas tomadas para el MVP v2, listas para implementar cuando se decida
arrancar la etapa 1.

**Decisiones cerradas:** alcance = clínica completa; foco inicial = pacientes
directos; interfaz principal = bot de Telegram; estrategia de carga = libre +
guiada; primer dato estructurado prioritario = `categoria`; cobros parciales
= eventos separados.

**Regla base:** en v2 los montos se guardan siempre positivos.
`tipo_movimiento` (`ingreso`/`egreso`) indica la dirección, no el signo —
evita mezclar signo con semántica de negocio. `monto_original` y
`saldo_pendiente` son siempre ≥ 0.

### Categorías cerradas

| Ingresos | Egresos |
|---|---|
| `consulta` | `sueldos` |
| `tratamiento` | `honorarios` |
| `anticipo` | `insumos` |
| `sena` | `alquiler` |
| `cuota` | `expensas` |
| `saldo_final` | `servicios` |
| `cobro_pendiente` | `impuestos` |
| `otro_ingreso` | `mantenimiento` |
| | `software` |
| | `otro_egreso` |

### Estados de pago

`pendiente`, `parcial`, `cobrado` (ingreso completo), `pagado` (egreso
completo), `vencido`, `cancelado`.

### Campos del movimiento v2

`id`, `user_id`, `tipo_movimiento`, `categoria`, `subcategoria`,
`estado_pago`, `descripcion`, `paciente_nombre`, `profesional_nombre`,
`proveedor_nombre`, `tratamiento_nombre`, `metodo_pago`, `moneda`,
`monto_original`, `monto_pesos`, `saldo_pendiente`, `fecha_prestacion`,
`fecha_cobro_real`, `fecha_vencimiento`, `fecha_carga`, `origen_carga`,
`referencia_id`, `notas`, `legacy_row_id`.

### Reglas funcionales por caso

- **Ingreso contado**: `estado_pago=cobrado`, `saldo_pendiente=0`.
- **Ingreso pendiente**: `estado_pago=pendiente`, `saldo_pendiente=monto_original`.
- **Ingreso parcial**: `estado_pago=parcial`, `saldo_pendiente>0`, cada cobro
  se registra como evento separado (no solo se pisa el saldo).
- **Egreso pagado**: `estado_pago=pagado`, `saldo_pendiente=0`.
- **Egreso pendiente**: `estado_pago=pendiente`, `saldo_pendiente=monto_original`.

**Eventos separados sugeridos:** `cobro_parcial`, `cobro_total`,
`pago_parcial`, `pago_total`, `ajuste_saldo`, `creacion`.

### Parser del bot — mensaje libre (debe seguir funcionando igual)

`consulta Juan Perez $15000 efectivo`, `anticipo Marta implante $50000
transferencia`, `cuota Juan $30000 tarjeta`, `gasto guantes $12000
transferencia`, `honorarios Dra Lopez $180000 transferencia`.

### Flujos guiados propuestos (para cuando falten datos o haga falta precisión)

- `/ingreso_paciente`: paciente → profesional → categoría → tratamiento
  (opcional) → monto → moneda → método de pago → fecha de prestación
  (opcional) → ¿queda saldo pendiente?
- `/egreso`: categoría → descripción → proveedor (opcional) → profesional
  (opcional) → monto → método de pago → fecha de vencimiento (opcional) →
  ¿ya fue pagado?
- `/registrar_pendiente`, `/cobro_parcial`.

### Reportes MVP obligatorios (cuando se implemente el modelo v2)

- [x] `/por_profesional`: ingresos del mes por profesional — cantidad de
  movimientos, cobrado, pendiente. **Implementado.**
- [x] `/cobros_por_metodo`: cobros del mes por método (efectivo, transferencia,
  tarjeta, etc.) con total y peso relativo. **Implementado.**
- [x] `/deudores`: ingresos pendientes agrupados por paciente — saldo,
  cantidad y vencimiento. **Implementado.**
- [x] `/egresos_categoria`: egresos del mes por categoría — total, cantidad y
  peso relativo. **Implementado.**

> Los 4 reportes leen del modelo legacy/v1 vía `obtenerDatosSheet` y toleran
> datos sin categoría/paciente/profesional (los agrupan como "sin
> categoría"/"Sin nombre"/"Sin profesional"). Funcionan ya, sin esperar la
> migración completa a v2. Viven en `command.service.js` + un handler por
> comando en `src/handlers/commands/`.

### Compatibilidad durante la transición

Los movimientos viejos pueden no tener `categoria` útil; los reportes nuevos
deben tolerar nulls/`legacy`; el bot puede completar defaults mientras no
tenga toda la data nueva.

### Orden de implementación recomendado

1. Schema v2 en Supabase.
2. Persistencia v2.
3. Parser y flujos guiados.
4. Cobros parciales con eventos.
5. Reportes nuevos.

### Fuera del MVP inmediato

Obras sociales completas, fecha de presentación/acreditación real, cuentas a
pagar avanzadas, alertas automáticas, presupuesto vs. real (estas ya están
cubiertas como etapas 2-5 de la sección 3).

---

## 5. Backlog técnico y archivos que probablemente haya que tocar

**Archivos:** `sql/schema.sql`, `src/services/db.service.js`,
`src/services/movimiento.service.js`, `src/services/command.service.js`,
`src/services/quick_nlp.service.js`, `src/services/gemini.service.js`,
`src/handlers/text.js`, `src/utils/sheet-row.js`,
`src/services/sheet.service.js`, `scripts/migrate-sheet.js`.

**Bloques de trabajo sugeridos:**
1. **Base de datos y modelo**: definir `movimientos_v2`, decidir si los pagos
   parciales van en tabla aparte, actualizar `schema.sql` y `db.service.js`,
   definir compatibilidad con `sheet.service`.
2. **Parser y captura**: ampliar `quick_nlp.service.js` y `gemini.service.js`
   para detectar categorías/campos nuevos, agregar estados conversacionales
   nuevos en `state/index.js`, agregar comandos guiados.
3. **Persistencia y migración**: decidir qué columnas extra van a Sheets,
   migrar datos viejos donde se pueda, soportar filas viejas sin campos
   nuevos, asegurar que los reportes no se rompan con datos mixtos.
4. **Reportes**: unificar criterio de pesos consolidados, agregar reportes
   por método/profesional/pendientes consolidados, preparar proyecciones.
5. **Web**: ya hecha — solo falta exponer los datos nuevos cuando existan.

**Riesgos técnicos a controlar:**
- Querer modelar demasiado y romper la carga rápida → mantener siempre el
  mensaje libre, el flujo guiado es solo para casos complejos.
- Duplicar lógica entre Sheet y Supabase → Supabase como modelo objetivo,
  Sheet como vista de respaldo mientras dure la transición.
- Datos viejos incompletos → soportar nulls, etiquetar legacy, no exigir
  retromigración perfecta desde el día 1.
- Reportes inconsistentes por mezcla de monedas → `monto_pesos` como base
  única de reporting consolidado.

### Sprints sugeridos (si hubiera que arrancar ya)

**Sprint 1:** agregar `categoria`/`paciente_nombre`/`profesional_nombre`/
`saldo_pendiente`; flujo guiado de ingreso de paciente; flujo guiado de
egreso categorizado; distinguir pendiente/parcial; primer reporte por
profesional.

**Sprint 2:** agregar `fecha_prestacion`/`fecha_vencimiento`; consolidado de
saldos por paciente; reporte por método de cobro; mejorar migración/
compatibilidad con Sheet.

**Sprint 3:** cuentas a pagar básicas; entidad proveedor; alertas simples;
reevaluar alcance de la web (ya cubierto, en la práctica).

---

## 6. IA Agéntica — evaluación para Cashy

Hoy el bot es un pipeline lineal: `text.js` parsea con regex/quick_nlp/Gemini
un intent fijo y ejecuta una sola acción (`handleNLPIntent`). Gemini hoy NO
usa function calling, solo devuelve JSON (`responseMimeType: "application/json"`
en `gemini.service.js`).

"Agéntico" significa que el modelo, en vez de devolver un intent fijo, recibe
una lista de **tools** (funciones reales del bot) y decide cuál(es) invocar y
en qué orden, encadenando varios pasos a partir de una sola frase.

### Casos de uso evaluados

1. **Comandos compuestos en una frase**: "cobrale a Juan los $15000 de ayer y
   decime cuánto me queda pendiente del mes" — hoy requiere 2-3 comandos
   separados, agéntico lo resuelve en un solo turno.
2. **Consultas ad-hoc sin comando fijo**: "cuánto cobré en dólares la semana
   pasada vs. la anterior" — no calza en `/balance`/`/semana`/`/mes`.
3. **Corrección conversacional post-confirmación**: extender
   `nlp-confirm.js` para que un mensaje de seguimiento edite el último
   movimiento en vez de crear uno nuevo.
4. **Alertas inteligentes de cobros pendientes** (ya está como feature
   pendiente) con priorización en vez de un cron fijo.

**No usar agéntico** para extracción de campos de un solo paso (ej. `consulta
Juan Perez $15000 efectivo`) — ahí el regex/quick_nlp actual ya resuelve bien
y un loop de tools sería más costo y latencia sin beneficio.

### Cómo se implementaría el caso 1 (cobro + consulta de pendientes)

Piezas reusables como tools:
- `command.service.js` (búsqueda de pendiente por paciente, hoy parte de
  `ejecutarCobrar`) → tool `buscar_pendiente(paciente)`.
- `command.service.js` (lógica de marcar cobrado/cobro parcial) → tool
  `cobrar_movimiento(idUnico, montoCobrado?)`.
- `db.service.js` (`getRows`) → base para tool nueva `get_pendientes(periodo)`.

Cambios necesarios: agregar `tools` a la generationConfig de Gemini en
`gemini.service.js`; un loop de ejecución nuevo (en `text.js` o un
`agent.service.js` nuevo) que llame a Gemini, ejecute el toolCall si
corresponde, vuelva a llamar con el resultado, y repita hasta agotar
toolCalls o un máximo de pasos (guardrail anti loop infinito); reusar el
patrón de botones de `nlp-confirm.js` para confirmar antes de ejecutar tools
de **escritura** — las de **lectura** se ejecutan directo.

**Riesgo principal:** se gana flexibilidad pero se pierde previsibilidad y
control de costo — cada paso del loop es una llamada a Gemini, y los bugs de
"el modelo decidió mal qué tool llamar" son más difíciles de debuggear que un
regex que falla. Mitigación: límite duro de pasos por turno y confirmación
humana obligatoria para toda tool que escriba datos.

---

## 7. Migración legacy `index.js` → `src/` (histórico, ya completo)

Este fue un proyecto de refactor que tuvo dos versiones de documento (uno
informal por fases, otro redefinido con metodología SDD) — ambos describían
el mismo trabajo, ya terminado:

- **Runtime oficial**: confirmado, `src/index.js` es el entrypoint real;
  `index.js` raíz queda como legacy, no participa del arranque.
- **Agenda por foto, helpers de filas de Sheets normalizados, guardado
  unificado de movimientos, `text.js` como orquestador, delegación común
  entre comandos y NLP**: todas estas fases quedaron marcadas como hechas.
- **Paridad funcional total** y **retiro controlado del legacy**: la
  auditoría de QA (ver sección 8) encontró que la base modular está
  avanzada y el bot no depende del legacy — quedó como pendiente solo la
  validación manual extremo a extremo en Telegram real, no como bloqueante
  estructural.

No se necesita seguir manteniendo un documento de fases para esto — el
refactor cumplió su objetivo. Si en el futuro aparece trabajo de refactor
nuevo, conviene abrir un documento específico para eso en vez de reabrir
este historial.

---

## 8. QA conocido / pendiente de validación manual

Última auditoría registrada: 2026-05-19, basada en revisión de código +
Supabase + Sheets + `npm test` (sin pruebas manuales extremo a extremo en
Telegram real). Hallazgos que siguen siendo relevantes:

- ~~**Inconsistencia en el flujo de invitación**: la documentación sugiere
  `/start` + ingresar código, pero el camino operativo real es `/unir
  CODIGO`.~~ **Resuelto.** Se unificó a un solo camino público: `/unir
  CODIGO` (`joinWithInviteCode`). Se eliminó el código muerto del paso
  `codigoInvitacion`/`beginInviteRegistration` que nunca se activaba, se
  corrigió el mensaje de `/codigo` para que apunte a `/unir`, y se documentó
  el comando en `/ayuda` y en el mensaje de registro de `/start`.
- **`movimientos_v2` y `movimiento_eventos_v2` no estaban desplegadas** en
  Supabase al momento de la auditoría (solo existían `profiles` y
  `movimientos`) — relevante para cuando se arranque la etapa 1 del roadmap
  de negocio (sección 3).
- **Reportes nuevos del MVP v2** (`/por_profesional`, `/cobros_por_metodo`,
  `/deudores`, `/egresos_categoria`): **ya implementados** (sección 4). Falta
  validación manual extremo a extremo en Telegram real con datos cargados.
- **Sin QA manual extremo a extremo en Telegram real** asentado — todo lo
  validado fue por código/tests, no por uso real del bot.

Estos puntos no bloquean el uso actual del bot (los tests pasan, no hay
crashes detectados, no hay dependencia operativa del legacy), pero conviene
tenerlos en cuenta antes de dar por "cerrada" la paridad funcional total o
de avanzar con el modelo v2.
