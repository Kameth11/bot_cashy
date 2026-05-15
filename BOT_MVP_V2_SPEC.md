# Bot Cashy MVP V2 Spec

## Objetivo

Definir una version 2 del modelo funcional del bot para clinica completa, con foco inicial en pacientes directos y manteniendo Telegram como interfaz principal.

## Decisiones cerradas

- alcance: clinica completa
- foco inicial: pacientes directos
- interfaz principal: bot de Telegram
- estrategia de carga: libre + guiada
- primer dato estructurado prioritario: `categoria`
- cobros parciales: eventos separados
- reportes prioritarios:
  - por profesional
  - por metodo
  - deudores
  - egresos por categoria

## Regla base del modelo

En v2 los montos se guardan siempre positivos.

- `tipo_movimiento = ingreso` indica entrada de dinero
- `tipo_movimiento = egreso` indica salida de dinero
- `monto_original` es siempre mayor a cero
- `saldo_pendiente` es siempre mayor o igual a cero

Esto evita mezclar signo con semantica del negocio.

## Categorias cerradas del MVP

### Ingresos

| Categoria | Uso |
|---|---|
| `consulta` | Cobro de consulta aislada |
| `tratamiento` | Cobro directo de tratamiento |
| `anticipo` | Pago adelantado de tratamiento |
| `sena` | Reserva o seña |
| `cuota` | Pago de cuota de plan |
| `saldo_final` | Cobro de saldo final |
| `cobro_pendiente` | Cobro asociado a deuda previa |
| `otro_ingreso` | Excepcion controlada |

### Egresos

| Categoria | Uso |
|---|---|
| `sueldos` | Sueldos del personal |
| `honorarios` | Honorarios de profesionales |
| `insumos` | Insumos y materiales |
| `alquiler` | Alquiler |
| `expensas` | Expensas |
| `servicios` | Luz, agua, internet, telefono |
| `impuestos` | IVA, ingresos brutos, ganancias, monotributo |
| `mantenimiento` | Reparaciones y mantenimiento de equipos |
| `software` | Sistemas, suscripciones, licencias |
| `otro_egreso` | Excepcion controlada |

## Estados de pago

| Estado | Significado |
|---|---|
| `pendiente` | Aun no cobrado o pagado |
| `parcial` | Cobrado o pagado en parte |
| `cobrado` | Ingreso completamente cobrado |
| `pagado` | Egreso completamente pagado |
| `vencido` | Ya paso la fecha esperada o vencimiento |
| `cancelado` | Dado de baja o anulado |

## Campos del movimiento v2

| Campo | Tipo | Requerido | Uso |
|---|---|---|---|
| `id` | uuid | si | identificador unico |
| `user_id` | bigint | si | dueño del movimiento |
| `tipo_movimiento` | text | si | `ingreso` o `egreso` |
| `categoria` | text | si | categoria cerrada del MVP |
| `subcategoria` | text | no | detalle adicional |
| `estado_pago` | text | si | pendiente, parcial, cobrado, etc |
| `descripcion` | text | si | texto libre legible |
| `paciente_nombre` | text | no | paciente asociado |
| `profesional_nombre` | text | no | profesional asociado |
| `proveedor_nombre` | text | no | proveedor asociado |
| `tratamiento_nombre` | text | no | tratamiento o plan |
| `metodo_pago` | text | no | efectivo, transferencia, tarjeta, obra_social, otro |
| `moneda` | text | si | pesos o dolares |
| `monto_original` | numeric | si | monto nominal positivo |
| `monto_pesos` | numeric | si | monto consolidado a pesos |
| `saldo_pendiente` | numeric | si | saldo restante positivo |
| `fecha_prestacion` | date | no | fecha del servicio o hecho economico |
| `fecha_cobro_real` | date | no | cuando efectivamente entro o salio el dinero |
| `fecha_vencimiento` | date | no | fecha esperada o limite |
| `fecha_carga` | timestamptz | si | alta en sistema |
| `origen_carga` | text | si | bot, web, sheet o migracion |
| `referencia_id` | uuid | no | vinculo con otro movimiento |
| `notas` | text | no | texto libre adicional |
| `legacy_row_id` | text | no | referencia al dato viejo si aplica |

## Reglas funcionales

### Ingreso contado

- `estado_pago = cobrado`
- `saldo_pendiente = 0`
- `fecha_cobro_real` puede ser hoy por default

### Ingreso pendiente

- `estado_pago = pendiente`
- `saldo_pendiente = monto_original`
- no requiere `fecha_cobro_real`

### Ingreso parcial

- `estado_pago = parcial`
- `saldo_pendiente > 0`
- los cobros se registran como eventos separados

### Egreso pagado

- `estado_pago = pagado`
- `saldo_pendiente = 0`

### Egreso pendiente

- `estado_pago = pendiente`
- `saldo_pendiente = monto_original`

## Eventos separados

Cada cobro o pago parcial no debe sobrescribir solo el saldo. Tambien debe registrarse como evento.

Tipos iniciales sugeridos:

- `cobro_parcial`
- `cobro_total`
- `pago_parcial`
- `pago_total`
- `ajuste_saldo`
- `creacion`

## Reglas del parser del bot

### Mensaje libre

Debe seguir funcionando para velocidad.

Ejemplos esperados:

- `consulta Juan Perez $15000 efectivo`
- `anticipo Marta implante $50000 transferencia`
- `cuota Juan $30000 tarjeta`
- `gasto guantes $12000 transferencia`
- `honorarios Dra Lopez $180000 transferencia`

### Flujo guiado

Debe existir para casos donde falten datos o haya que forzar precision.

Flujos minimos propuestos:

- `/ingreso_paciente`
- `/egreso`
- `/registrar_pendiente`
- `/cobro_parcial`

## Datos minimos por flujo guiado

### `/ingreso_paciente`

1. paciente
2. profesional
3. categoria
4. tratamiento opcional
5. monto
6. moneda
7. metodo de pago
8. fecha de prestacion opcional
9. queda saldo pendiente si/no

### `/egreso`

1. categoria
2. descripcion
3. proveedor opcional
4. profesional opcional
5. monto
6. metodo de pago
7. fecha de vencimiento opcional
8. ya fue pagado si/no

## Reportes MVP obligatorios

### `/por_profesional`

Debe mostrar por profesional:

- cantidad de movimientos
- ingresos cobrados
- pendientes

### `/cobros_por_metodo`

Debe mostrar:

- efectivo
- transferencia
- tarjeta
- obra social si existiera

### `/deudores`

Debe consolidar por paciente:

- monto original
- cobrado
- saldo pendiente
- vencimiento si existe

### `/egresos_categoria`

Debe agrupar por categoria:

- total
- cantidad
- peso relativo en el periodo

## Compatibilidad con el modelo actual

Durante la transicion:

- los movimientos viejos pueden no tener `categoria` util
- los reportes nuevos deben tolerar nulls o valores `legacy`
- el bot puede completar defaults mientras no tenga toda la data nueva

## Criterio de implementacion

Orden recomendado:

1. schema v2
2. persistencia v2
3. parser y flujos guiados
4. cobros parciales con eventos
5. reportes nuevos

## Fuera del MVP inmediato

Queda para siguiente etapa:

- obras sociales completas
- fecha de presentacion y acreditacion real
- cuentas a pagar avanzadas
- alertas automaticas
- presupuesto vs real
- web completa
