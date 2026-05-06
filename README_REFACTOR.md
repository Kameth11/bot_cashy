# Plan de Refactor - Cashy

## Objetivo

Migrar completamente la logica legacy de `index.js` raiz hacia `src/`, reduciendo duplicacion y dejando una arquitectura modular, sin romper los flujos actuales del bot.

## Regla principal

- No borrar `index.js` legacy hasta tener paridad funcional en `src/`
- Hacer cambios por fases chicas
- Validar cada fase antes de seguir
- Mantener comportamiento actual del bot durante toda la migracion

---

## Estado actual

### Legacy
- `index.js` raiz contiene toda la logica del bot en un solo archivo
- Tiene config, auth, sheets, comandos, NLP, agenda por foto, estados temporales y boot del bot

### Modular
- `src/` ya tiene gran parte del bot separada por handlers, services, utils y state
- Todavia no tiene paridad total con `index.js`

### Gap principal detectado
- La funcionalidad de agenda por foto todavia vive solo en `index.js`

---

## Fases del trabajo

## Fase 1 - Confirmar runtime real
### Objetivo
Confirmar si el bot que se usa realmente arranca desde `index.js` o desde `src/index.js`

### Tareas
- Revisar comando de arranque en `package.json`
- Confirmar flujo real de ejecucion
- Marcar `index.js` como legacy de referencia si `src/index.js` es el runtime actual

### Validacion
- Queda claro cual es el entrypoint real del bot

### Estado
- [ ] Pendiente
- [ ] En progreso
- [x] Hecho

---

## Fase 2 - Migrar agenda por foto a `src/`
### Objetivo
Mover la funcionalidad faltante de lectura de agenda por imagen a la arquitectura modular

### Extraer desde `index.js`
- `procesarFotoAgenda`
- `crearTabAgendaSiNoExiste`
- `pendingAgendaConfirm`
- `bot.on('photo')`

### Archivos destino sugeridos
- `src/services/openai_vision.service.js`
- `src/services/agenda.service.js`
- `src/handlers/photo.js`
- `src/state/index.js`

### Tareas
- [x] Crear servicio para parsear imagen de agenda
- [x] Crear servicio para crear/acceder a tab `Agenda`
- [x] Crear handler de fotos
- [x] Agregar estado `pendingAgendaConfirm`
- [x] Integrar confirmacion del guardado de turnos
- [x] Declarar dependencia de Vision en el runtime modular
- [x] Evitar que Vision rompa el arranque si falta la dependencia
- [x] Endurecer guardado de Agenda para distinguir fallo total vs parcial
- [ ] Probar flujo real en Telegram con una foto

### Validacion
- Mandando una foto de agenda, el bot:
  - procesa la imagen
  - detecta turnos
  - pide confirmacion
  - guarda en la tab `Agenda`

### Estado
- [ ] Pendiente
- [x] En progreso
- [ ] Hecho

---

## Fase 3 - Unificar helpers de filas de Google Sheets
### Objetivo
Eliminar repeticion en acceso a columnas con nombres variables

### Problema actual
Se repiten muchos accesos como:
- `Descripcion | descripcion | Paciente | Nombre`
- `ID_Unico | ID_unico | ID_uNico | idunico`
- `Monto | monto`
- `Fecha | fecha`

### Archivos destino sugeridos
- `src/utils/sheet-row.js`

### Tareas
- [x] Crear helpers para leer filas normalizadas
- [x] Reutilizarlos en:
  - [x] eliminar
  - [x] editar
  - [x] listar
  - [x] cobrar
  - [ ] debug
  - [x] command.service
  - [x] limpiar
  - [x] NLP
- [ ] Probar comandos reales en Telegram

### Validacion
- Los comandos siguen funcionando igual
- Baja la duplicacion de codigo

### Estado
- [ ] Pendiente
- [x] En progreso
- [ ] Hecho

---

## Fase 4 - Unificar guardado de movimientos
### Objetivo
Centralizar la construccion de `rowData` y el alta de movimientos

### Problema actual
La estructura del movimiento se arma varias veces en distintos flujos:
- texto directo
- NLP
- flujo con cotizacion
- flujo con metodo de pago

### Archivos destino sugeridos
- `src/services/movimiento.service.js`
- o helper nuevo dentro de `src/services/`

### Tareas
- Extraer funcion para construir `rowData`
- Extraer funcion para persistir movimiento
- Reusar en todos los flujos actuales

### Validacion
- Un movimiento guardado desde cualquier camino genera el mismo resultado

### Estado
- [ ] Pendiente
- [ ] En progreso
- [ ] Hecho

---

## Fase 5 - Separar registro e invitaciones del text handler
### Objetivo
Achicar `src/handlers/text.js` y dejarlo como orquestador

### Archivos destino sugeridos
- `src/services/registration.service.js`
- `src/services/invite.service.js`

### Tareas
- Extraer flujo de registro
- Extraer validacion de email
- Extraer flujo de invitaciones
- Extraer union por codigo
- Mantener `text.js` solo para routing del flujo

### Validacion
- `/start`, `/codigo`, `/unir`, `/cancelar` siguen funcionando igual
- Menos logica embebida en `text.js`

### Estado
- [ ] Pendiente
- [ ] En progreso
- [ ] Hecho

---

## Fase 6 - Afinar comandos para que deleguen en services
### Objetivo
Evitar que comandos y NLP dupliquen logica

### Tareas
- Revisar comandos que todavia tienen demasiada logica inline
- Delegar todo lo posible a `src/services/command.service.js`
- Reusar la misma logica desde comandos y desde NLP

### Validacion
- `/eliminar` y "elimina X" usan la misma base
- `/editar` y "edita X" usan la misma base
- `/cobrar` y lenguaje natural no divergen en comportamiento

### Estado
- [ ] Pendiente
- [ ] En progreso
- [ ] Hecho

---

## Fase 7 - Verificacion de paridad total
### Objetivo
Confirmar que `src/` cubre todo lo importante del legacy

### Checklist funcional
- [ ] Registro de usuario
- [ ] Validacion por email
- [ ] Union por codigo
- [ ] Reportes (`/balance`, `/hoy`, `/semana`, `/mes`, `/ingresos`, `/egresos`, `/pendientes`)
- [ ] Cobrar movimientos
- [ ] Eliminar movimientos
- [ ] Editar movimientos
- [ ] Limpiar filas invalidas
- [ ] Reiniciar cuenta
- [ ] NLP de texto
- [ ] Flujo de cotizacion dolar
- [ ] Flujo de metodo de pago
- [ ] Agenda por foto
- [ ] Confirmaciones pendientes
- [ ] Cancelacion con `/cancelar`

### Estado
- [ ] Pendiente
- [ ] En progreso
- [ ] Hecho

---

## Fase 8 - Retiro del legacy
### Objetivo
Dejar de depender de `index.js` raiz

### Tareas
- Confirmar que no queda ninguna funcionalidad exclusiva del legacy
- Dejar `index.js` como backup temporal o eliminarlo
- Documentar que el entrypoint oficial es `src/index.js`

### Validacion
- El bot funciona completo sin depender del monolito legacy

### Estado
- [ ] Pendiente
- [ ] En progreso
- [ ] Hecho

---

## Riesgos a vigilar

- Romper flujos multi-step por estados `pending*`
- Diferencias entre comandos slash y lenguaje natural
- Diferencias entre acceso directo a Google Sheets y capa `db.service`
- Cambios involuntarios en mensajes al usuario
- Funcionalidad de agenda incompleta durante la migracion

---

## Regla de trabajo por conversacion

En cada conversacion nueva:
1. Leer este archivo primero
2. Elegir una sola fase o subfase
3. Implementar cambios chicos
4. Verificar que no rompa lo existente
5. Marcar avances en este archivo
6. No avanzar a la siguiente fase sin cerrar la anterior

---

## Proximo paso recomendado

Empezar por:
- **Fase 2 - Migrar agenda por foto a `src/`**

Motivo:
- Es la brecha funcional mas clara entre `index.js` y `src/`
- Permite acercarse a paridad real antes de limpiar duplicacion
