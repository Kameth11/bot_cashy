# QA Spec 7 - Paridad Funcional

Objetivo: validar que el runtime modular en `src/` cubre los flujos criticos del bot antes de retirar el legacy.

Runtime esperado:
- `npm start`
- entrypoint: `src/index.js`

Precondiciones:
- `.env` configurado
- bot accesible desde Telegram
- al menos un Google Sheet compartido con la service account
- si se prueba agenda por foto: `GEMINI_API_KEY` configurada
- si se prueba NLP remoto: `GEMINI_API_KEY` configurada

Convenciones de resultado:
- `[ ]` pendiente
- `[x]` ok
- `[~]` ok con observaciones
- `[!]` fallo

## Estado de este relevamiento

- Fecha: `2026-05-19`
- Fuente: auditoria de codigo + consulta a Supabase + inspeccion de Google Sheets + `npm test`
- Alcance: no se hicieron pruebas manuales extremo a extremo en Telegram
- Resultado local de tests: `22/22` pasando
- Hallazgo estructural clave: hoy en Supabase existen `profiles` y `movimientos`; `movimientos_v2` y `movimiento_eventos_v2` siguen sin desplegar

## Datos de prueba sugeridos

- Email autorizado: `verolincoln@gmail.com`
- Usuario owner Telegram: `1419810344`
- Usuario invitado Telegram: `________________`
- Sheet owner: `1rG4045qR3no1DmX8cq7NkZu9u_taY9oekLi--6F7vbU`
- Sheet invitado: `1-1iJju6OVeHQgoIQ6sdtxtaaaBwqh1OCm4vGF5FDrEE`

## 1. Arranque

- [~] `npm start` apunta al runtime correcto (`src/index.js`)
- [~] log esperado: `Bot iniciado correctamente` esta presente en el boot
- [~] si falta Gemini, el bot sigue arrancando por degradacion controlada en `gemini.service.js` y `vision.service.js`
- Observaciones:
- No se levanto el bot real en Telegram durante esta auditoria.
- `index.js` raiz esta deshabilitado correctamente.

## 2. Registro owner

- [~] `/start` responde mensaje de bienvenida o registro
- [~] si owner ya existe, no intenta re-registrar
- [~] si owner no existe, pide email
- [~] valida email incorrecto
- [~] valida email no autorizado
- [~] al ingresar email valido, pide `sheetId`
- [~] al ingresar `sheetId` valido, completa registro
- [~] `/sheet` devuelve link correcto
- Observaciones:
- El flujo esta implementado en `registration.service.js` y `sheet.js`.
- No fue ejercitado manualmente contra Telegram.

## 3. Invitaciones

- [~] `/codigo` genera codigo
- [!] el flujo documentado de `/start` + ingresar codigo no esta realmente cableado en el handler publico; el camino operativo hoy es `/unir CODIGO`
- [~] `/unir CODIGO` desde usuario invitado esta implementado
- [~] usuario invitado queda habilitado
- [~] usuario ya registrado no puede unirse otra vez de forma inconsistente
- Observaciones:
- Hay inconsistencia entre mensaje/documentacion y flujo real de invitacion.
- Conviene unificar un solo camino publico antes de cerrar Spec 7.

## 4. Registro manual de movimientos

- [~] `consulta Juan Perez $15000 efectivo`
- [~] `servicio Endodoncia U$50 transferencia`
- [~] `gasto Insumos $-500`
- [~] `pendiente Juan Perez $15000`
- [~] `/pendiente Juan Perez $15000`
- [x] si falta metodo en pesos, lo pide
- [x] si es en dolares, pide cotizacion
- [~] `/cancelar` corta el flujo pendiente
- Observaciones:
- La persistencia y completado de datos estan implementados y cubiertos parcialmente por tests.
- Hoy con `USE_SUPABASE=true` los movimientos se guardan en `movimientos`; esa tabla esta vacia en el entorno actual, por lo que todavia no hay datos reales cargados.

## 5. NLP rapido antes de IA

- [~] `entraron 15 lucas de Juan`
- [~] `se me fueron 8 lucas en insumos`
- [~] `me deben 20 lucas de Marta`
- [~] `ya me pagó Juan`
- [~] `cuanto tengo`
- [x] estos casos se resuelven aunque Gemini falle o no responda
- Observaciones:
- `quick-nlp.service.test.js` valida 16 casos representativos del parser local.
- Los ejemplos exactos de esta checklist no se probaron uno por uno en Telegram, pero el parser local cubre esa familia de frases.

## 6. NLP remoto como fallback

- [~] ante texto no cubierto por parser rapido, intenta Gemini
- [ ] si Gemini responde con intent valido, el flujo continua bien
- [~] si Gemini falla, el bot no se cae
- [ ] el mensaje final sigue siendo coherente
- Observaciones:
- El fallback remoto esta implementado.
- No hubo prueba online real contra Gemini en esta auditoria.

## 7. Reportes

- [~] `/balance`
- [~] `/hoy`
- [~] `/semana`
- [~] `/mes`
- [~] `/ingresos`
- [~] `/egresos`
- [~] `/pendientes`
- [~] slash commands y lenguaje natural equivalente no divergen a nivel de arquitectura
- Observaciones:
- Los handlers slash y NLP reutilizan `command.service.js`.
- Faltan todavia los reportes nuevos del MVP v2: `/por_profesional`, `/cobros_por_metodo`, `/deudores`, `/egresos_categoria`.

## 8. Gestion de pendientes

- [~] `/cobrar ultimo`
- [~] `/cobrar Juan`
- [~] `/cobrar Juan 5000` cobra parcial
- [~] no permite cobrar mas que el saldo pendiente
- [~] actualiza estado o saldo correctamente
- Observaciones:
- La logica esta implementada.
- En el modelo actual el cobro parcial ajusta saldo/estado en legacy; no hay trazabilidad de eventos porque `movimientos_v2` y `movimiento_eventos_v2` no existen en la base actual.

## 9. Edicion y eliminacion

- [~] `/editar Juan` encuentra coincidencia correcta
- [~] si hay varias coincidencias, avisa
- [~] permite cambiar descripcion
- [~] permite cambiar monto
- [~] confirmacion de edicion funciona
- [~] `/eliminar Juan` encuentra coincidencia correcta
- [~] si hay varias coincidencias, avisa
- [~] confirmacion de eliminacion funciona
- [~] slash y lenguaje natural equivalente comparten comportamiento
- Observaciones:
- Todo esto esta conectado a confirmaciones via `actions.js`.
- Falta validacion extremo a extremo con Telegram real.

## 10. Listado y utilidades

- [~] `/listar`
- [~] `/debug`
- [~] `/limpiar`
- [~] `/regenerar_ids`
- [~] `/dolar`
- [~] `/actualizardolar`
- Observaciones:
- Los comandos existen y tienen logica real; no se detectaron stubs vacios.
- `debug` y `limpiar` dependen del estado real del Sheet, por lo que resta prueba manual.

## 11. Agenda por foto

- [~] enviar foto real de agenda
- [~] detecta turnos
- [~] muestra preview
- [~] pide confirmacion
- [~] `confirm_agenda` guarda en tab `Agenda`
- [~] `cancel_agenda` descarta
- [~] si la imagen no parece agenda, avisa sin caerse
- Observaciones:
- El flujo esta implementado.
- En el Sheet owner ya existe tab `Agenda` con 19 filas.
- Falta prueba real con una foto durante esta pasada.

## 12. Confirmaciones y cancelacion

- [~] si hay confirmacion pendiente, bloquea flujos incompatibles
- [~] `/cancelar` limpia:
- [~] registro pendiente
- [~] pago pendiente
- [~] cotizacion pendiente
- [~] edicion pendiente
- [~] eliminacion pendiente
- [~] agenda pendiente
- [~] reinicio pendiente
- Observaciones:
- `cancelar.js` limpia todos esos estados.
- `text.js` y `photo.js` tambien bloquean flujos incompatibles cuando hay estados pendientes.

## 13. Multiusuario y aislamiento

- [~] owner ve su propio sheet
- [~] invitado puede operar segun el modelo esperado
- [~] no aparece leakage evidente entre cuentas
- [~] `/sheet` devuelve el sheet correcto para cada usuario
- Observaciones:
- La arquitectura esta pensada para aislamiento por owner/sheet.
- Hay dos modos de invitacion parcialmente mezclados (`/unir CODIGO` vs registro con `ownerId`), por lo que este punto todavia necesita validacion manual fina.

## 14. Criterio de salida

Se considera `Spec 7` razonablemente validada si:

- [~] no hay crashes en los flujos principales a nivel de codigo/tests locales
- [~] slash commands y NLP no divergen en acciones criticas a nivel de arquitectura
- [~] agenda por foto funciona o falla de forma controlada en codigo
- [ ] registro, invitaciones, cobro, edicion y eliminacion funcionan extremo a extremo
- [x] no aparece dependencia operativa del `index.js` legacy

## Resultado final

- Estado general: `En progreso`
- Fecha: `2026-05-19`
- Probado por: `OpenCode`
- Bloqueantes encontrados:
- `movimientos_v2` y `movimiento_eventos_v2` no estan desplegadas en Supabase
- `movimientos` esta vacia en la base actual
- el flujo publico de invitaciones esta inconsistente entre documentacion/mensajes y comandos reales
- no hay QA manual Telegram extremo a extremo asentado todavia
- Observaciones finales:
- La base modular en `src/` esta bastante avanzada y el bot no depende del `index.js` legacy.
- Lo mas atrasado no es la estructura de comandos, sino la validacion real extremo a extremo y el cierre de la transicion de datos/modelo hacia Supabase v2.
