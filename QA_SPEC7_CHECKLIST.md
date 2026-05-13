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

## Datos de prueba sugeridos

- Email autorizado: `________________`
- Usuario owner Telegram: `________________`
- Usuario invitado Telegram: `________________`
- Sheet owner: `________________`
- Sheet invitado: `________________`

## 1. Arranque

- [ ] `npm start` levanta sin crash
- [ ] log esperado: bot iniciado correctamente
- [ ] si falta Gemini, el bot sigue arrancando
- Observaciones:

## 2. Registro owner

- [ ] `/start` responde mensaje de bienvenida o registro
- [ ] si owner ya existe, no intenta re-registrar
- [ ] si owner no existe, pide email
- [ ] valida email incorrecto
- [ ] valida email no autorizado
- [ ] al ingresar email valido, pide `sheetId`
- [ ] al ingresar `sheetId` valido, completa registro
- [ ] `/sheet` devuelve link correcto
- Observaciones:

## 3. Invitaciones

- [ ] `/codigo` genera codigo
- [ ] el codigo se puede usar una sola vez segun el flujo esperado
- [ ] `/unir CODIGO` desde usuario invitado funciona
- [ ] usuario invitado queda habilitado
- [ ] usuario ya registrado no puede unirse otra vez de forma inconsistente
- Observaciones:

## 4. Registro manual de movimientos

- [ ] `consulta Juan Perez $15000 efectivo`
- [ ] `servicio Endodoncia U$50 transferencia`
- [ ] `gasto Insumos $-500`
- [ ] `pendiente Juan Perez $15000`
- [ ] `/pendiente Juan Perez $15000`
- [ ] si falta metodo en pesos, lo pide
- [ ] si es en dolares, pide cotizacion
- [ ] `/cancelar` corta el flujo pendiente
- Observaciones:

## 5. NLP rapido antes de IA

- [ ] `entraron 15 lucas de Juan`
- [ ] `se me fueron 8 lucas en insumos`
- [ ] `me deben 20 lucas de Marta`
- [ ] `ya me pagó Juan`
- [ ] `cuanto tengo`
- [ ] estos casos se resuelven aunque Gemini falle o no responda
- Observaciones:

## 6. NLP remoto como fallback

- [ ] ante texto no cubierto por parser rapido, intenta Gemini
- [ ] si Gemini responde con intent valido, el flujo continua bien
- [ ] si Gemini falla, el bot no se cae
- [ ] el mensaje final sigue siendo coherente
- Observaciones:

## 7. Reportes

- [ ] `/balance`
- [ ] `/hoy`
- [ ] `/semana`
- [ ] `/mes`
- [ ] `/ingresos`
- [ ] `/egresos`
- [ ] `/pendientes`
- [ ] slash commands y lenguaje natural equivalente no divergen
- Observaciones:

## 8. Gestion de pendientes

- [ ] `/cobrar ultimo`
- [ ] `/cobrar Juan`
- [ ] `/cobrar Juan 5000` cobra parcial
- [ ] no permite cobrar mas que el saldo pendiente
- [ ] actualiza estado o saldo correctamente
- Observaciones:

## 9. Edicion y eliminacion

- [ ] `/editar Juan` encuentra coincidencia correcta
- [ ] si hay varias coincidencias, avisa
- [ ] permite cambiar descripcion
- [ ] permite cambiar monto
- [ ] confirmacion de edicion funciona
- [ ] `/eliminar Juan` encuentra coincidencia correcta
- [ ] si hay varias coincidencias, avisa
- [ ] confirmacion de eliminacion funciona
- [ ] slash y lenguaje natural equivalente comparten comportamiento
- Observaciones:

## 10. Listado y utilidades

- [ ] `/listar`
- [ ] `/debug`
- [ ] `/limpiar`
- [ ] `/regenerar_ids`
- [ ] `/dolar`
- [ ] `/actualizardolar`
- Observaciones:

## 11. Agenda por foto

- [ ] enviar foto real de agenda
- [ ] detecta turnos
- [ ] muestra preview
- [ ] pide confirmacion
- [ ] `confirm_agenda` guarda en tab `Agenda`
- [ ] `cancel_agenda` descarta
- [ ] si la imagen no parece agenda, avisa sin caerse
- Observaciones:

## 12. Confirmaciones y cancelacion

- [ ] si hay confirmacion pendiente, bloquea flujos incompatibles
- [ ] `/cancelar` limpia:
- [ ] registro pendiente
- [ ] pago pendiente
- [ ] cotizacion pendiente
- [ ] edicion pendiente
- [ ] eliminacion pendiente
- [ ] agenda pendiente
- [ ] reinicio pendiente
- Observaciones:

## 13. Multiusuario y aislamiento

- [ ] owner ve su propio sheet
- [ ] invitado puede operar segun el modelo esperado
- [ ] no aparece leakage evidente entre cuentas
- [ ] `/sheet` devuelve el sheet correcto para cada usuario
- Observaciones:

## 14. Criterio de salida

Se considera `Spec 7` razonablemente validada si:

- [ ] no hay crashes en los flujos principales
- [ ] slash commands y NLP no divergen en acciones criticas
- [ ] agenda por foto funciona o falla de forma controlada
- [ ] registro, invitaciones, cobro, edicion y eliminacion funcionan extremo a extremo
- [ ] no aparece dependencia operativa del `index.js` legacy

## Resultado final

- Estado general: `________________`
- Fecha: `________________`
- Probado por: `________________`
- Bloqueantes encontrados:
- Observaciones finales:
