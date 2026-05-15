# Roadmap Cashy Clinica

## Objetivo

Dejar documentado que tiene hoy `bot_cashy`, que le falta para servir como sistema real de cashflow de consultorio/clinica, y en que orden conviene construirlo antes de decidir una version web completa.

Este documento parte del estado actual del codigo y se va a usar como base de trabajo para iterar.

## Decisiones Actuales

Definidas en esta conversacion como punto de partida:

- alcance objetivo inicial: clinica completa
- foco de ingresos de la primera version bien modelada: pacientes directos
- prioridad inmediata deseada: mejorar el bot antes de ir a web

Implicancias practicas:

- el modelo ya tiene que nacer preparado para multiples profesionales
- aunque el foco inicial no sea obras sociales, no conviene cerrar el modelo de forma que despues las complique
- el siguiente backlog deberia concentrarse en captura estructurada dentro del bot, no en interfaz web

Decisiones adicionales del MVP del bot:

- carga de ingresos: combinacion de mensaje libre y flujo guiado
- primer dato estructurado prioritario: `categoria`
- cobros parciales: modelarlos como eventos separados
- primera tanda de reportes: por profesional, por metodo, deudores y egresos por categoria

## Diagnostico Rapido

Hoy Cashy funciona bien como:

- captura rapida de movimientos por Telegram
- vista simple en Google Sheets
- soporte basico para pendientes
- reportes operativos simples por dia, semana y mes
- base tecnica inicial para migrar a Supabase y luego a una web

Hoy Cashy no alcanza todavia como:

- sistema de cashflow clinico completo
- sistema de seguimiento de obras sociales / prepagas
- tablero financiero con proyecciones
- herramienta de gestion por profesional
- sistema de deuda y vencimientos con trazabilidad

## Lo Que Ya Tiene

### Registro de movimientos

Cashy ya puede registrar:

- ingresos
- egresos
- pendientes de cobro
- cobros parciales
- monedas en pesos y dolares
- metodo de pago: efectivo, transferencia, tarjeta

Campos actuales del movimiento:

- `fecha`
- `hora`
- `descripcion`
- `monto`
- `estado`
- `tipo`
- `moneda`
- `metodoPago`
- `idUnico`
- `montoPesos`
- `idOrigen`

### Reportes actuales

Comandos existentes:

- `/balance`
- `/hoy`
- `/semana`
- `/mes`
- `/ingresos`
- `/egresos`
- `/pendientes`
- `/listar`

### Operacion actual

- Telegram como interfaz principal de carga
- Google Sheets como vista editable / respaldo
- Supabase disponible como backend opcional
- estructura inicial de autenticacion web en schema (`web_user_id`, RLS)

### Funcionalidad adicional

- lectura de agenda por foto
- extraccion de `consultorio`, `profesional`, `hora`, `cliente`, `servicio`, `estado`

Importante:

La agenda existe, pero hoy no esta conectada con los movimientos de caja.

## Checklist Contra La Necesidad De Clinica / Consultorio

### Ingresos

#### Cobros a pacientes

Estado: parcial bueno

Ya tiene:

- registro de cobros a pacientes
- efectivo / tarjeta / transferencia
- monto en pesos o dolares
- pendientes basicos

Falta:

- distinguir paciente en campo propio, no solo en descripcion
- separar anticipo, seña, cuota, saldo final
- vincular varios cobros a un mismo tratamiento o plan

#### Cobros de obras sociales / prepagas

Estado: no real

Hoy se puede escribir algo como descripcion libre, pero el sistema no entiende de forma estructurada:

- nombre de obra social o prepaga
- fecha de prestacion
- fecha de presentacion
- fecha estimada de acreditacion
- fecha real de acreditacion
- lote / liquidacion
- estado de cobro por OS

#### Planes de pago / cuotas pendientes

Estado: parcial debil

Ya tiene:

- movimientos pendientes
- cobro parcial simple

Falta:

- cuota 1, cuota 2, cuota 3
- vencimientos por cuota
- historial de pagos parciales
- saldo consolidado por paciente

#### Anticipos y senas

Estado: parcial debil

Hoy puede cargarse como descripcion libre, por ejemplo `sena implante`, pero no queda tipificado.

Falta:

- categoria especifica `anticipo` o `sena`
- relacion con tratamiento posterior
- saldo remanente del tratamiento

### Egresos

Estado general: parcial bueno para operacion simple, insuficiente para gestion

Hoy se pueden cargar como texto libre:

- sueldos
- honorarios
- insumos
- alquiler
- expensas
- servicios
- impuestos
- mantenimiento
- software

Falta estructura para reportar:

- categoria
- subcategoria
- proveedor
- profesional asociado
- fecha de vencimiento
- periodicidad
- centro de costo

Sin eso, el dato existe pero no es confiable para analisis serio.

### Control de deudas

#### Pacientes con saldo pendiente

Estado: si, basico

Ya tiene:

- listado de pendientes
- marcar como cobrado
- cobro parcial simple

Falta:

- saldo por paciente consolidado
- historial de pagos
- fecha de vencimiento
- alertas de mora

#### Facturas de proveedores a pagar

Estado: no

Hoy podria registrarse como gasto pendiente a mano, pero no existe flujo especifico para cuentas a pagar.

Falta:

- proveedor
- vencimiento
- estado de pago
- prioridad
- alerta de proximo vencimiento

#### Vencimientos de obras sociales

Estado: no

No existe seguimiento de fechas esperadas ni atrasos de acreditacion.

### Logica temporal

Estado: insuficiente

Hoy Cashy maneja solo la fecha/hora de carga del movimiento.

Falta distinguir entre:

- fecha de prestacion
- fecha de carga
- fecha de presentacion
- fecha de vencimiento
- fecha estimada de cobro
- fecha real de cobro

Esto es critico para:

- obras sociales que pagan a 45-90 dias
- cuotas y planes de pago
- proveedores con vencimiento
- proyeccion de flujo futuro

### Reportes clave

#### Flujo diario / semanal / mensual

Estado: si

Existe y funciona.

#### Por forma de cobro

Estado: no suficiente

El dato `metodoPago` existe, pero no hay reporte dedicado por:

- efectivo
- transferencia
- tarjeta
- obra social / prepaga

#### Por profesional

Estado: no

Existe el concepto de `profesional` en agenda, pero no en movimiento financiero.

#### Presupuesto vs real

Estado: no

No existe entidad de presupuesto, meta o plan mensual.

#### Proyeccion minima 30/60/90 dias

Estado: no

No existe porque faltan fechas futuras estructuradas.

#### Alertas de saldo minimo

Estado: no

No existe configuracion de caja minima ni alertas.

## Problemas De Modelo Actual

### 1. Movimiento demasiado generico

El movimiento actual sirve para registrar rapido, pero no alcanza para analisis clinico real.

Todo termina concentrado en `descripcion`.

### 2. Falta de entidades del negocio

No hay campos propios para:

- paciente
- profesional
- proveedor
- obra social
- tratamiento
- cuota
- vencimiento

### 3. Falta de trazabilidad temporal

No se puede responder bien:

- cuanto facture hoy pero cobro en 60 dias
- que pagos me entran el proximo mes
- que proveedores vencen la semana que viene

### 4. Reportes limitados

Los reportes sirven para caja simple, no para gestion.

### 5. Riesgo con montos en dolares

Existe `montoPesos`, pero los reportes actuales usan mucho `monto`. Antes de dashboard serio hay que unificar criterio de calculo para reporting.

## Conclusion Sobre La Web

### La web hoy no deberia ser prioridad 1

Hacer una web ahora seria mostrar mas lindo un modelo todavia incompleto.

Eso sirve si el objetivo es solo visualizacion simple.

No sirve si el objetivo es gestion financiera real de clinica.

### Cuando si merece web

La web pasa a tener mucho valor cuando ya existan:

- categorias estructuradas
- temporalidad correcta
- cuentas por cobrar y por pagar reales
- profesional / paciente / OS como entidades visibles
- reportes confiables

## Roadmap Recomendado

## Etapa 0 - Definicion funcional

Objetivo:

Definir exactamente el negocio que Cashy va a modelar.

Entregables:

- lista final de tipos de ingresos
- lista final de tipos de egresos
- definicion de si primero se apunta a consultorio simple o clinica multi profesional
- definicion de si obras sociales entran en MVP o en etapa 2

Preguntas a resolver:

- Cashy sera para un profesional, varios profesionales o una clinica completa
- El foco inicial es caja diaria o gestion financiera completa
- Obras sociales son centrales o accesorias

## Etapa 1 - Normalizar el movimiento financiero

Objetivo:

Que el movimiento deje de ser solo texto libre y pase a tener campos estructurados.

Campos minimos propuestos:

- `categoria`
- `subcategoria`
- `entidad_tipo`
- `entidad_nombre`
- `paciente`
- `profesional`
- `proveedor`
- `obra_social`
- `tratamiento`
- `estado_pago`
- `monto_original`
- `saldo_pendiente`
- `moneda`
- `monto_pesos`

Impacto:

- mejora reportes
- mejora filtros
- prepara la futura web

## Etapa 2 - Agregar temporalidad real

Objetivo:

Modelar cuando ocurre el hecho economico y cuando ocurre el flujo de caja.

Campos minimos propuestos:

- `fecha_prestacion`
- `fecha_carga`
- `fecha_presentacion`
- `fecha_vencimiento`
- `fecha_cobro_estimada`
- `fecha_cobro_real`
- `fecha_pago_real`

Impacto:

- proyecciones 30/60/90
- OS / prepagas reales
- cuentas a pagar

## Etapa 3 - Cuentas por cobrar y pagar

Objetivo:

Pasar de pendiente simple a deuda trazable.

Capacidades minimas:

- saldo pendiente por paciente
- saldo pendiente por proveedor
- historial de cobros parciales
- historial de pagos parciales
- vencimientos proximos
- vencidos

Idealmente agregar:

- tabla o estructura de eventos de pago
- no solo sobrescribir el saldo actual

## Etapa 4 - Reportes de gestion

Objetivo:

Pasar de caja simple a decisiones.

Reportes minimos:

- flujo diario / semanal / mensual
- ingresos por metodo de cobro
- ingresos por paciente
- ingresos por profesional
- ingresos por obra social
- egresos por categoria
- pendientes por vencer
- cobrado vs pendiente
- caja proyectada a 30/60/90 dias

## Etapa 5 - Configuracion y alertas

Objetivo:

Agregar gestion preventiva.

Configuraciones propuestas:

- saldo minimo de caja
- dias de alerta antes del vencimiento
- categorias activas
- profesionales activos
- obras sociales activas

Alertas propuestas:

- saldo bajo
- OS vencida sin acreditar
- proveedor proximo a vencer
- paciente con mora

## Etapa 6 - Web MVP

Objetivo:

Construir una web cuando la data ya merezca ser visualizada y gestionada mejor.

Alcance minimo recomendado:

- login
- dashboard principal
- movimientos con filtros
- pendientes por cobrar
- cuentas a pagar
- reportes basicos
- boton para abrir Sheet como respaldo

No recomendado para MVP web:

- rehacer toda la carga desde cero
- meter demasiadas pantallas sin antes fijar bien el modelo

## Recomendacion De Prioridad

Orden sugerido realista:

1. definir alcance funcional exacto
2. rediseñar modelo de datos
3. mejorar carga via Telegram para guardar datos estructurados
4. mejorar reportes
5. recien despues hacer web

## Criterio De Decision

### Si hoy solo queres operar mejor

No hace falta web todavia.

Conviene primero:

- ordenar categorias
- ordenar pendientes
- separar fechas importantes

### Si hoy queres vender o presentar el producto

Puede valer una web minima solo de lectura, pero con la conciencia de que seria una capa visual sobre un modelo aun incompleto.

## Primer Backlog Propuesto

Orden de construccion inicial:

1. definir categorias de ingresos y egresos
2. definir entidades de negocio: paciente, profesional, proveedor, obra social
3. definir fechas necesarias por tipo de movimiento
4. definir como se modela cuota / anticipo / sena / saldo
5. actualizar schema de Supabase
6. actualizar columnas del Sheet o estrategia de compatibilidad
7. adaptar parser y comandos del bot
8. agregar reportes nuevos
9. evaluar web MVP

## Backlog Tecnico Del Bot

## Objetivo tecnico inmediato

Mejorar el bot sin romper el flujo actual de carga rapida.

La idea no es reemplazar de golpe el modelo actual, sino llevarlo desde movimiento generico a movimiento estructurado en etapas, manteniendo compatibilidad operativa.

## Principios de implementacion

- mantener Telegram como interfaz principal de carga
- no exigir demasiados datos en cada mensaje libre
- permitir carga rapida y despues enriquecimiento
- no bloquear uso actual por querer modelar todo de una vez
- usar Supabase como modelo objetivo y Sheets como vista/respaldo mientras dure la transicion

## MVP Funcional Del Bot

### Lo minimo que deberia poder hacer la nueva version

1. registrar ingresos de pacientes con categoria clara
2. registrar egresos con categoria clara
3. guardar paciente y profesional cuando aplique
4. distinguir anticipo, sena, cuota y saldo final
5. guardar fecha de prestacion y fecha de cobro cuando aplique
6. manejar pendientes con saldo consolidado
7. reportar por metodo de cobro y por profesional

### Lo que puede esperar a etapa 2

1. obras sociales completas
2. cuentas a pagar complejas con proveedor y vencimientos multiples
3. presupuesto vs real
4. alertas automaticas
5. web completa

## Modelo De Datos Objetivo Para El Bot

### Movimiento financiero v2

Campos sugeridos para la nueva estructura:

- `id`
- `user_id`
- `tipo_movimiento`
- `categoria`
- `subcategoria`
- `estado_pago`
- `descripcion`
- `paciente_nombre`
- `profesional_nombre`
- `proveedor_nombre`
- `tratamiento_nombre`
- `metodo_pago`
- `moneda`
- `monto_original`
- `monto_pesos`
- `saldo_pendiente`
- `fecha_prestacion`
- `fecha_cobro_real`
- `fecha_vencimiento`
- `fecha_carga`
- `origen_carga`
- `referencia_id`
- `notas`

### Valores sugeridos para `tipo_movimiento`

- `ingreso`
- `egreso`

### Valores sugeridos para `categoria`

Ingresos:

- `consulta`
- `tratamiento`
- `anticipo`
- `sena`
- `cuota`
- `saldo_final`
- `cobro_pendiente`

Egresos:

- `sueldos`
- `honorarios`
- `insumos`
- `alquiler`
- `expensas`
- `servicios`
- `impuestos`
- `mantenimiento`
- `software`
- `otros`

### Valores sugeridos para `estado_pago`

- `cobrado`
- `pendiente`
- `parcial`
- `pagado`
- `vencido`

## Estrategia De Transicion

### Fase A - Enriquecer sin romper

Mantener los campos actuales y sumar metadata nueva en Supabase primero.

Durante esta fase:

- el bot sigue aceptando mensajes libres
- si puede extraer nuevos campos, los guarda
- si no puede, guarda lo minimo actual

Ventaja:

- no frena operacion
- permite migracion progresiva

### Fase B - Comandos guiados

Agregar comandos guiados para carga mas precisa cuando haga falta.

Ejemplos sugeridos:

- `/ingreso_paciente`
- `/egreso`
- `/cuota`
- `/anticipo`
- `/saldo`

### Fase C - Reportes sobre el modelo nuevo

Cuando la captura ya guarde categorias y profesional, se agregan reportes nuevos.

## Cambios Recomendados En El Bot

## 1. Nuevos flujos de carga

### Flujo libre actual

Debe seguir existiendo.

Ejemplos:

- `consulta Juan Perez $15000 efectivo`
- `gasto guantes $12000 transferencia`

### Flujo guiado nuevo

Para los casos que necesiten precision.

Ejemplo ideal:

1. `/ingreso_paciente`
2. bot pregunta paciente
3. bot pregunta profesional
4. bot pregunta categoria: consulta, anticipo, cuota, saldo final
5. bot pregunta monto
6. bot pregunta metodo de pago
7. bot pregunta si queda saldo pendiente

Esto evita forzar al NLP a resolver todo desde texto libre.

## 2. Pendientes mejorados

Hoy el pendiente se maneja como una fila con saldo mutable.

Objetivo de mejora:

- mantener saldo actual
- registrar cada cobro parcial como evento
- poder reconstruir historial

Modelo sugerido:

- movimiento principal: deuda original
- eventos asociados: pagos parciales

Si no se quiere crear una segunda tabla al inicio, al menos hay que guardar una bitacora basica en texto o JSON.

## 3. Profesional en movimientos

Agregar `profesional_nombre` desde el bot.

Motivo:

- clinica completa necesita corte por profesional
- despues permite comisiones, honorarios y productividad

## 4. Paciente en movimientos

Agregar `paciente_nombre` separado de `descripcion`.

Motivo:

- permite saldo consolidado por paciente
- mejora busqueda
- mejora reportes

## 5. Categorias duras

No depender solo de la descripcion.

Objetivo:

- que `insumos` no quede mezclado con `alquiler`
- que `anticipo` no quede mezclado con `consulta`

## 6. Fechas nuevas

Agregar gradualmente:

- `fecha_prestacion`
- `fecha_vencimiento`
- `fecha_cobro_real`

Aunque sea opcional en la primera etapa.

## 7. Reportes nuevos del bot

Reportes sugeridos para la primera tanda:

- `/caja_hoy`
- `/cobros_por_metodo`
- `/por_profesional`
- `/deudores`
- `/egresos_categoria`

No hace falta eliminar los actuales; conviene agregar estos y convivir un tiempo.

## Backlog Tecnico Por Orden

## Bloque 1 - Base de datos y modelo

1. definir estructura `movimientos v2`
2. decidir si pagos parciales van en tabla aparte o dentro del movimiento
3. actualizar `sql/schema.sql`
4. actualizar `src/services/db.service.js`
5. definir estrategia de compatibilidad con `sheet.service`

## Bloque 2 - Parser y captura

1. ampliar `quick_nlp.service.js` para detectar categorias nuevas
2. ampliar `gemini.service.js` para extraer nuevos campos
3. adaptar `command.service.js` y `movimiento.service.js`
4. agregar estados conversacionales nuevos en `src/state/index.js`
5. agregar comandos guiados nuevos

## Bloque 3 - Persistencia y migracion

1. decidir que columnas extra iran a Sheets
2. agregar migracion de datos viejos cuando sea posible
3. soportar filas viejas sin campos nuevos
4. asegurar que reportes no se rompan con mezcla de datos viejos y nuevos

## Bloque 4 - Reportes

1. rehacer sumatorias para usar criterio consistente en pesos
2. agregar reportes por metodo
3. agregar reportes por profesional
4. agregar reportes de pendientes consolidados
5. preparar proyecciones futuras cuando existan fechas nuevas

## Bloque 5 - Preparacion web

1. exponer solo datos ya estables
2. definir dashboard minimo
3. usar web como lectura y gestion simple, no como parche del modelo

## Archivos Que Probablemente Habra Que Tocar

- `sql/schema.sql`
- `src/services/db.service.js`
- `src/services/movimiento.service.js`
- `src/services/command.service.js`
- `src/services/quick_nlp.service.js`
- `src/services/gemini.service.js`
- `src/handlers/text.js`
- `src/utils/sheet-row.js`
- `src/services/sheet.service.js`
- `scripts/migrate-sheet.js`

## Riesgos Tecnicos A Controlar

### Riesgo 1 - Querer modelar demasiado y romper la carga rapida

Mitigacion:

- mantener mensaje libre
- sumar flujo guiado solo para casos complejos

### Riesgo 2 - Duplicar logica entre Sheet y Supabase

Mitigacion:

- definir Supabase como modelo objetivo
- dejar Sheet como vista de respaldo mientras dure la transicion

### Riesgo 3 - Datos viejos incompletos

Mitigacion:

- soportar nulls
- etiquetar legacy
- no exigir retro migracion perfecta desde el dia 1

### Riesgo 4 - Reportes inconsistentes por mezcla de monedas

Mitigacion:

- fijar `monto_pesos` como base de reporting consolidado

## Sprint 1 Recomendado

Si hubiera que empezar ya, el Sprint 1 del bot deberia incluir:

1. agregar `categoria`, `paciente_nombre`, `profesional_nombre`, `saldo_pendiente`
2. crear flujo guiado para ingreso de paciente
3. crear flujo guiado para egreso categorizado
4. adaptar pendientes para distinguir `pendiente` y `parcial`
5. crear primer reporte por profesional

## Sprint 2 Recomendado

1. agregar `fecha_prestacion` y `fecha_vencimiento`
2. crear consolidado de saldos por paciente
3. crear reporte por metodo de cobro
4. mejorar migracion y compatibilidad con Sheet

## Sprint 3 Recomendado

1. introducir cuentas a pagar basicas
2. introducir proveedor
3. introducir alertas simples
4. reevaluar web MVP

## Notas De Trabajo

- Este roadmap es un documento vivo.
- Antes de implementar, conviene cerrar decisiones de negocio con respuestas simples y concretas.
- Si hay que elegir, conviene privilegiar primero exactitud del modelo sobre interfaz.

## Documentos relacionados

- `BOT_MVP_V2_SPEC.md`: definicion funcional del MVP v2 del bot
- `sql/schema_v2_draft.sql`: propuesta tecnica de schema v2 con eventos separados
