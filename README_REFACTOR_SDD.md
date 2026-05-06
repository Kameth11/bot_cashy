# Cashy Refactor Spec

## Metodologia

Este documento redefine el plan de migracion con enfoque SDD (`Spec Driven Development`).

La regla es simple:

- antes de tocar codigo, definir que comportamiento debe existir
- implementar cambios chicos contra una spec concreta
- validar la spec antes de avanzar
- no retirar `index.js` legacy hasta tener paridad funcional comprobada

---

## Objetivo del refactor

Migrar completamente la logica legacy de `index.js` raiz hacia `src/`, reduciendo duplicacion y consolidando una arquitectura modular sin romper los flujos actuales del bot.

---

## Invariantes del sistema

Estas reglas no se negocian durante la migracion:

- `index.js` legacy sigue existiendo hasta confirmar paridad total
- `src/index.js` debe conservar compatibilidad con el comportamiento actual del bot
- ningun cambio de fase puede romper flujos multi-step basados en estados `pending*`
- slash commands y lenguaje natural no deben divergir funcionalmente
- no se cambian mensajes al usuario salvo que la spec lo pida explicitamente
- cada fase debe dejar evidencia de validacion antes de continuar

---

## Estado actual

### Legacy
- `index.js` raiz concentra config, auth, sheets, comandos, NLP, agenda por foto, estados temporales y boot

### Modular
- `src/` ya contiene handlers, services, utils y state
- `src/index.js` es el entrypoint real actual
- ya existe cobertura de comandos, NLP, agenda por foto y boot principal
- todavia no hay paridad total con el legacy

### Gap principal actual
- la agenda por foto ya fue migrada a `src/`
- el gap operativo mas visible ya resuelto era la duplicacion del guardado de movimientos
- quedan validaciones funcionales y alineacion fina entre comandos, NLP y legacy

---

## Estructura SDD

Cada fase se trabaja asi:

1. `Spec`: que comportamiento debe cumplirse
2. `Scope`: que codigo puede tocarse
3. `Non-goals`: que no se resuelve en esta fase
4. `Acceptance`: como se valida paridad
5. `Status`: pendiente, en progreso o hecho

---

## Spec 1 - Runtime oficial

### Spec
El runtime oficial del bot debe quedar explicitamente identificado. Si el arranque real usa `src/index.js`, entonces `index.js` raiz queda tratado como referencia legacy y no como entrypoint operativo.

### Scope
- `package.json`
- `index.js`
- `src/index.js`
- documentacion de arranque

### Non-goals
- eliminar `index.js`
- refactorizar boot logic

### Acceptance
- el comando de arranque apunta al entrypoint real
- el equipo puede identificar sin ambiguedad cual archivo corre el bot
- `index.js` queda reconocido como legacy si no participa del arranque real

### Status
- Hecho

---

## Spec 2 - Agenda por foto

### Spec
Cuando el usuario envia una foto de agenda, el runtime modular debe:

- procesar la imagen
- detectar turnos
- pedir confirmacion
- guardar los turnos confirmados en la tab `Agenda`

### Scope
- `src/services/openai_vision.service.js`
- `src/services/agenda.service.js`
- `src/handlers/photo.js`
- `src/state/index.js`
- integracion con dependencia de Vision

### Non-goals
- redisenar el formato de agenda
- cambiar el copy de confirmacion salvo necesidad funcional

### Acceptance
- con una foto real en Telegram se detectan turnos
- el bot pide confirmacion antes de persistir
- el guardado distingue fallo total de guardado parcial
- si falta la dependencia de Vision, el bot no se cae al arrancar

### Estado de implementacion
- parseo de imagen: hecho
- acceso/creacion de tab `Agenda`: hecho
- handler de fotos: hecho
- estado `pendingAgendaConfirm`: hecho
- confirmacion de guardado: hecho
- dependencia Vision opcional en runtime: hecho
- endurecimiento de guardado: hecho
- prueba real en Telegram: pendiente

### Status
- En progreso

---

## Spec 3 - Filas de Google Sheets normalizadas

### Spec
Todo acceso a filas de Sheets con nombres variables de columnas debe pasar por helpers normalizados para evitar duplicacion y diferencias de lectura.

### Scope
- `src/utils/sheet-row.js`
- flujos de eliminar, editar, listar, cobrar, limpiar, NLP y `command.service`

### Non-goals
- redisenar el schema de Sheets
- migrar datos historicos

### Acceptance
- los comandos siguen funcionando igual
- las variantes de columnas como `Descripcion`, `descripcion`, `Paciente`, `Nombre` se resuelven por helper comun
- disminuye el acceso ad hoc a propiedades de fila en handlers y services

### Estado de implementacion
- helper normalizado: hecho
- eliminar: hecho
- editar: hecho
- listar: hecho
- cobrar: hecho
- debug: pendiente
- `command.service`: hecho
- limpiar: hecho
- NLP: hecho
- prueba real en Telegram: pendiente

### Status
- En progreso

---

## Spec 4 - Guardado unificado de movimientos

### Spec
Todo alta de movimiento, sin importar el camino de entrada, debe construir y persistir el mismo `rowData` mediante una unica capa compartida.

### Scope
- `src/services/movimiento.service.js` o equivalente
- texto directo
- NLP
- flujo con cotizacion
- flujo con metodo de pago

### Non-goals
- cambiar columnas del spreadsheet
- cambiar formato de negocio del movimiento

### Acceptance
- un movimiento creado por cualquier flujo produce el mismo resultado persistido
- no hay construcciones paralelas de `rowData` con logica distinta

### Estado de implementacion
- builder de `rowData`: hecho
- persistencia compartida: hecho
- reutilizacion en flujos actuales: hecho

### Status
- Hecho

---

## Spec 5 - Text handler como orquestador

### Spec
`src/handlers/text.js` debe limitarse a routing y coordinacion. La logica de registro, validacion por email, invitaciones y union por codigo debe vivir en services dedicados.

### Scope
- `src/handlers/text.js`
- `src/services/registration.service.js`
- `src/services/invite.service.js`

### Non-goals
- cambiar UX de `/start`, `/codigo`, `/unir`, `/cancelar`

### Acceptance
- `/start`, `/codigo`, `/unir`, `/cancelar` mantienen comportamiento
- `text.js` reduce logica embebida y delega a services

### Estado de implementacion
- flujo de registro: hecho
- validacion de email: hecho
- invitaciones: hecho
- union por codigo: hecho
- `text.js` como router: hecho

### Status
- Hecho

---

## Spec 6 - Delegacion comun entre comandos y NLP

### Spec
Los comandos slash y las entradas en lenguaje natural deben usar la misma base de logica de negocio para evitar divergencias de comportamiento.

### Scope
- comandos con logica inline restante
- `src/services/command.service.js`
- integraciones desde NLP

### Non-goals
- crear un nuevo parser NLP
- rehacer todos los handlers si no hace falta

### Acceptance
- `/eliminar` y `elimina X` comparten base funcional
- `/editar` y `edita X` comparten base funcional
- `/cobrar` y el flujo equivalente en lenguaje natural no divergen

### Estado de implementacion
- revision de inline logic restante: pendiente
- delegacion a `command.service`: pendiente
- reuso desde NLP: pendiente

### Status
- Pendiente

---

## Spec 7 - Paridad funcional total

### Spec
La arquitectura modular en `src/` debe cubrir toda funcionalidad relevante del legacy antes de retirar dependencias operativas de `index.js` raiz.

### Scope
- validacion funcional extremo a extremo
- comparacion con legacy
- checklist de capacidades

### Non-goals
- borrar legacy en esta fase

### Acceptance
- todos los flujos criticos listados abajo funcionan en `src/`
- no queda funcionalidad importante exclusiva del monolito legacy

### Checklist de paridad
- registro de usuario
- validacion por email
- union por codigo
- reportes: `/balance`, `/hoy`, `/semana`, `/mes`, `/ingresos`, `/egresos`, `/pendientes`
- cobrar movimientos
- eliminar movimientos
- editar movimientos
- limpiar filas invalidas
- reiniciar cuenta
- NLP de texto
- flujo de cotizacion dolar
- flujo de metodo de pago
- agenda por foto
- confirmaciones pendientes
- cancelacion con `/cancelar`

### Status
- Pendiente

---

## Spec 8 - Retiro controlado del legacy

### Spec
Solo despues de confirmar paridad total, `index.js` raiz puede dejar de ser parte del sistema operativo del bot y quedar como backup temporal o eliminarse.

### Scope
- `index.js`
- documentacion oficial
- entrypoint del proyecto

### Non-goals
- retirar legacy antes de cerrar Spec 7

### Acceptance
- no existe funcionalidad exclusiva del legacy
- el bot funciona completo desde `src/`
- la documentacion identifica a `src/index.js` como entrypoint oficial

### Status
- Pendiente

---

## Riesgos de migracion

- romper estados multi-step basados en `pending*`
- divergencia entre slash commands y lenguaje natural
- diferencias entre acceso directo a Google Sheets y `db.service`
- cambios involuntarios en mensajes al usuario
- agenda por foto con cobertura incompleta en validacion real

---

## Protocolo de trabajo por conversacion

En cada conversacion nueva:

1. leer primero `README_REFACTOR_SDD.md`
2. elegir una sola spec o sub-spec
3. definir la validacion antes de editar
4. hacer cambios chicos y acotados
5. verificar la acceptance de esa spec
6. actualizar estado en este archivo
7. no avanzar a la siguiente spec sin cerrar la actual

---

## Proximo paso recomendado

Trabajar sobre una sola subfase:

`Spec 3 - prueba funcional real de comandos` o `Spec 2 - prueba real de agenda por foto`

Prioridad sugerida:

1. cerrar validacion real de `Spec 3`
2. cerrar validacion real de `Spec 2`
3. avanzar con `Spec 6`

Razon:

- la mayor parte del refactor estructural ya esta implementada
- ahora el mayor valor esta en confirmar paridad observable
- despues de eso conviene eliminar divergencias finales entre comandos y NLP
