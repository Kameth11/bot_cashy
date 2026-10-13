# Notas 2026-10-13 — Notificaciones que no llegaban, permisos de Personal y cómo detectar este tipo de errores

Resumen de una sesión de diagnóstico. Sirve como bitácora y como guía para la próxima vez.

---

## 1. Qué pasó

**Síntoma:** no llegaba ninguna notificación de la web, ni en la campanita ni el push al iPhone (PWA).

**Causa real (bug de código, no de configuración):** `notificaciones` y `push_subscriptions` se
agregaron a `PERSONA_TABLES` (`src/lib/persona-db.js`) pero **no** a `SCOPED_TABLES`
(`src/lib/tenant-db.js`). `forPersona()` se apoya en `forTenant()`, que lanza si la tabla no está en
`SCOPED_TABLES`. Resultado: cada lectura y escritura de esas tablas fallaba con

```
Tabla 'notificaciones' no esta en SCOPED_TABLES de tenant-db.js. Agregala si tiene datos de negocio, ...
```

Se veía en los logs de Railway como `Error GET /api/notificaciones` (scope `NOTIF`), repetido cada
vez que alguien abría la web.

**Arreglo:** commit `0d7d504` — las dos tablas se agregaron a `SCOPED_TABLES` y hay un test nuevo
(`tests/lib.tenant-db.test.js`) que exige que toda tabla de `PERSONA_TABLES` esté también en
`SCOPED_TABLES`. Antes, solo `chat_historial` se había agregado en los dos lugares.

### Por qué no lo atraparon los tests ni el CI

1. `tests/notificaciones.service.test.js` mockea `resolveTenantId` → `null`, así que el servicio
   siempre cae al modo memoria y **nunca ejecuta el camino de Supabase** (`forPersona`).
2. `tests/api.notificaciones.test.js` mockea el servicio completo.
3. `scripts/check-tenant-isolation.js` (`npm run check:tenant`) tiene **su propia copia** de
   `PERSONA_TABLES` y solo verifica que cada tabla consultada esté clasificada; no compara contra la
   lista de `persona-db.js`. Dos listas duplicadas que pueden desincronizarse.
4. En el servicio, `fallo()` registra un `warn` y sigue (degradación silenciosa), y en producción
   nadie mira los logs hasta que algo se rompe a la vista.

---

## 2. Cómo se encontró (para repetirlo)

1. **Pedir los logs de Railway** (Deployments → View logs, o el JSON). Buscar `severity: "error"` y el
   `scope`. Acá apareció enseguida: el mismo error repetido.
2. Leer el mensaje exacto: nombraba el archivo y la lista que faltaba tocar.
3. Comparar las dos listas (`persona-db.js` vs `tenant-db.js`) con `git diff` del rango del pull.
4. Antes de esto se descartó lo que parecía lo obvio (claves VAPID, iPhone, registro de profesional):
   **si falla también la campanita, el problema no es el push**, porque la campanita no depende de VAPID.

Regla práctica: **cuando algo "no llega", mirar primero los logs del servidor antes de tocar
configuración del cliente.**

---

## 3. Cómo detectar este tipo de errores antes de producción

Mejoras recomendadas, de más barata a más completa (las marcadas ✅ ya están hechas):

| # | Mejora | Qué evita |
|---|---|---|
| ✅ | Test `PERSONA_TABLES ⊆ SCOPED_TABLES` | Este bug exacto |
| ✅ 1 y 2 | `check-tenant-isolation.js` importa `PERSONA_TABLES` de `persona-db.js`; test de notificaciones con `forPersona` real sobre Supabase falso (`tests/notificaciones.service.supabase.test.js`) | Listas desincronizadas y camino de Supabase sin ejecutar |
| ✅ 1 | Registro único de tablas `src/lib/tablas.js`: de ahí se derivan `SCOPED_TABLES`, `PERSONA_TABLES` y las listas de `check-tenant-isolation.js` | Listas desincronizadas |
| 2 | Tests de servicio que usen el **`forPersona`/`forTenant` reales** con un cliente Supabase falso (como ya hace `lib.tenant-db.test.js`), no `resolveTenantId → null` | Que el camino de Supabase quede sin ejecutar |
| ✅ 3 | Chequeo de arranque `src/lib/verificar-tablas.js`: consulta cada tabla del registro y loguea `error` con la migración que falta (no tumba el servidor; una tabla `opcional` solo da `warn`) | Enterarse en el deploy y no cuando un usuario lo nota |
| ✅ 4 | **Aviso por Telegram** ante cada `logger.error` (`src/lib/alertas.js`). Railway no tiene alertas sobre el contenido de los logs, solo sobre estado del deploy y recursos | Errores que se repiten durante horas sin que nadie los vea |
| 5 | Humo post-deploy: tras cada deploy, un script que cree un aviso de prueba y verifique que aparece en `GET /api/notificaciones` | Regresiones de flujos enteros |
| ✅ 6 | Test `tests/lib.tablas.test.js`: toda tabla creada por una migración tiene que estar en el registro (y viceversa) | Olvidos al agregar una tabla |
| ✅ 7 | Que los `catch` con respaldo distingan error de programación/configuración (`logger.error`) de fallo transitorio (`logger.warn`): `src/lib/errores.js` → `logFallo()` | Degradación silenciosa |

**Checklist al agregar una tabla nueva** (el CI cubre casi todo; lo manual está marcado):

- [ ] Migración en `sql/migrations/NNN_*.sql`.
- [ ] Una entrada en `src/lib/tablas.js` con su `ambito` (`negocio`, `persona`, `global` o `borrador`; `opcional: true` si el código funciona sin ella). Nada más: las demás listas se derivan.
- [ ] **A mano:** aplicar la migración en el SQL Editor de Supabase (el deploy no la corre).
- [ ] `npm run check:tenant` y `npm test` en verde (el test falla si falta el registro; el chequeo falla si se consulta con la puerta equivocada).
- [ ] Tras el deploy, mirar los logs de Railway: si falta la tabla, aparece `Falta la tabla 'X' en Supabase` con `level=error`.

---

## 4. Cómo funcionan (y cómo se activan) las notificaciones

### Quién recibe avisos
- Solo el **profesional del turno**, y solo si está **registrado** (bot: `/profesional`, o dashboard:
  Config → Profesionales).
- Eventos: llegada del paciente, turno nuevo, turno cancelado, no vino. Cargar un movimiento **no** avisa.
- **No se avisa a quien hizo el cambio.** Si el profesional crea o marca un turno suyo desde su propia
  cuenta, no le llega nada (`omitido: 'es_quien_lo_hizo'`). Para probar hay que actuar desde **otra cuenta**.
- El turno tiene que traer el campo profesional, y el nombre tiene que coincidir con el registrado
  (se ignoran tildes, mayúsculas y títulos Dr./Dra.; se acepta que uno contenga al otro).

### `/profesional` en el bot
No acepta el nombre en la misma línea: `/profesional Laura` ignora "Laura" y abre un registro en dos pasos
(1° mensaje: nombre; 2° mensaje: consultorio o `ninguno`).

### Activar el Web Push (una sola vez, para todo el servicio)
1. `npx web-push generate-vapid-keys` → Public Key y Private Key.
2. En Railway → servicio → Variables: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y
   `VAPID_SUBJECT=mailto:<mail del operador>`. Sin espacios ni saltos de línea al pegar.
3. Correr `sql/migrations/020_notificaciones_web.sql` en el SQL Editor de Supabase. Sin esa tabla las
   suscripciones viven en memoria y **se pierden en cada deploy**.
4. En cada dispositivo: abrir la PWA desde el ícono de inicio y activar los avisos en la campanita.

Notas:
- Es **un solo par de claves para todo el servicio**, no uno por usuario ni por consultorio. El
  `VAPID_SUBJECT` solo identifica al operador ante Apple/Google; puede ser siempre el mismo mail.
- Cambiar las claves invalida las suscripciones existentes: hay que **desactivar y reactivar** los avisos
  en cada dispositivo (crea una suscripción nueva con la clave nueva). No hacerlo sin necesidad.
- **iPhone:** iOS 16.4+ y la PWA instalada (Compartir → Agregar a inicio) y abierta desde ese ícono.
  Desde Safari no llega. Los modos Concentración / No molestar pueden silenciarlo.
- La campanita funciona sin VAPID; solo el push lo necesita.

### Diagnóstico rápido

| Lo que se ve | Causa probable |
|---|---|
| Ni campanita ni push, errores `Error GET /api/notificaciones` en logs | Bug de tablas (este documento) |
| Campanita sí, push no | Faltan/están mal las claves VAPID, o el dispositivo no está suscripto |
| Campanita dice "claves inválidas" | `VAPID_PUBLIC_KEY`/`PRIVATE_KEY` mal pegadas |
| Push llegaba y dejó de llegar tras un deploy | Falta la migración 020 (suscripciones en memoria) |
| Probando con tu propia cuenta no llega | Es esperado: no se avisa a quien hizo el cambio |
| Log `profesional no registrado con /profesional` | El nombre del turno no coincide con el registrado |
| Log `Falló un push` con `status` 403 | Claves VAPID que no coinciden con la suscripción |

---

## 5. Permisos: cargar en Personal / Casa sin `cargar_movimientos`

**Antes:** un odontólogo (preset con solo `ver_agenda` y `editar_agenda`) no podía cargar nada por el
bot, ni siquiera un gasto personal, porque el permiso `cargar_movimientos` se exigía antes de decidir el
ámbito.

**Ahora** (commit `dd39427`):
- `registrar_movimiento` en ámbito **personal** o **casa** no pide `cargar_movimientos`
  (`src/handlers/nlp.js`). Vale para texto, notas de voz (`src/handlers/voice.js`) y el chat web.
- Pasar un movimiento a **consultorio** con el botón de ámbito, y **guardar** en consultorio, sí lo
  exigen (`src/handlers/nlp-confirm.js`). Así no es una puerta al consultorio.
- Un gasto ambiguo ("super 5000") sigue cayendo en consultorio y se rechaza sin el permiso. Para ir a
  Personal hay que decirlo ("super 5000 personal") o venir de un término ya aprendido.
- Solo rige con `PERSONAL_STORE=supabase` (producción). En modo `sheets` los invitados siguen forzados a
  consultorio.
- Las fotos de comprobantes siguen yendo a consultorio y pidiendo el permiso.

Quién puede qué (ver `src/auth/permisos.js`): el default de un miembro es `['ver_agenda']`;
`cargar_movimientos` solo viene en el preset `recepcion`; el dueño tiene todo implícito.

---

## 6. Otros hallazgos de la sesión

- El pull trajo la dependencia `web-push`; hizo falta `npm install` (sin ella fallaban 30 suites).
- Las migraciones nuevas son la 015 a la 022 y se aplican a mano.
- `CLAUDE.md` dice "No se tocan los tests por ahora (decisión del usuario)", pero el repo ya incorpora
  muchos tests; esa línea parece desactualizada. Revisarla.

---

## 7. Severidad de los logs: `error` vs `warn` (`src/lib/errores.js`)

Los servicios con respaldo atrapan los fallos de Supabase para no romper la acción del usuario.
Para que eso no esconda errores nuestros, `logFallo(scope, mensaje, err, extra)` decide la severidad:

- **`logger.error`** (hay que arreglarlo): `TypeError`/`ReferenceError`/`RangeError`/`SyntaxError`, las guardas de
  `tenant-db.js`/`persona-db.js` (tabla sin registrar, falta `userId`/`tenantId`), y errores de Supabase con código
  de esquema o permisos (`42501`, `42703`, `42883`, `42P01`, `PGRST200/202/204/205`).
- **`logger.warn`** (pasajero): red, timeouts y el resto.

Además pasaron a `error`: tabla faltante (migración sin correr, una vez por arranque), claves VAPID inválidas
(una vez por combinación de claves) y push rechazado con 401/403 (claves VAPID que no coinciden).

Aplicado en notificaciones, chat-historial, personal (presupuesto), invitaciones y comprobante-archivo. Los demás
`warn` de servicios son fallos esperados (duplicados, dual-write, datos de fecha ilegible, profesional no
registrado) y se dejaron como estaban. **Regla para código nuevo:** en un `catch` con respaldo, usar `logFallo` y
no `logger.warn(..., err.message)` a mano. Con esto, una alerta de Railway sobre `level=error` apunta a cosas que
siempre requieren acción.

---

## 8. Avisos de errores por Discord o Telegram (`src/lib/alertas.js`)

Cada `logger.error` le llega al admin, por Discord si hay webhook configurado y si no por Telegram. Railway solo alerta por estado del deploy y recursos
(CPU/RAM), no por el contenido de los logs, y esto es lo que habría avisado del bug de las notificaciones.

- **Cómo:** `logger.js` expone `suscribirErrores(fn)`, que se dispara solo en `error` (nunca en warn/info, así
  un aviso que falla no genera otro). `iniciarAlertas()` se suscribe al arrancar (`src/index.js`).
- **Límites:** el mismo error (scope + mensaje) avisa como mucho 1 vez cada 15 min y el siguiente aviso cuenta
  las repeticiones; tope global de 8 avisos por hora, y lo omitido se informa en el próximo.
- **Qué manda:** scope, mensaje, `err`, código y status. Las cadenas largas parecidas a claves se reemplazan por `[…]`.
- **Config (Railway → Variables):**
  - `ALERTAS_DISCORD_WEBHOOK_URL`: webhook de un canal de Discord. Si está, los avisos van ahí y no a Telegram.
    Es un **secreto** (quien lo tenga puede escribir en el canal): no se loguea ni se commitea. Solo se acepta una
    URL `https://discord.com/api/webhooks/<id>/<token>` (o discordapp.com / ptb / canary); otra cosa se ignora y
    se cae a Telegram. Los mensajes no mencionan a nadie (`allowed_mentions` vacío).
  - Para crearlo: en Discord → Ajustes del servidor → Integraciones → Webhooks → Nuevo webhook → elegir el canal
    → Copiar URL del webhook.
  - `ALERTAS_CHAT_ID` (solo Telegram; default `AUTHORIZED_USER_ID`; sirve un grupo) y `ALERTAS_ERRORES=off` para apagar todo.
- **Límite:** si el proceso se cae del todo no puede avisar. Complemento recomendado: Railway → Settings →
  Webhooks con los eventos de deploy `Failed` y `Crashed`.
- **Regla:** como cada `error` genera un aviso, usar `error` solo para lo que hay que arreglar y `warn` para
  lo transitorio (`logFallo`, ver sección 7).
