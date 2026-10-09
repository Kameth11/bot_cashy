# Notas de conversación — 2026-10-09

Resumen de lo hablado en una sesión de trabajo: lo que se implementó, lo que
quedó como idea y los puntos a tener en cuenta. Las decisiones de fondo siguen
viviendo en `ARCHITECTURE.md`; esto es el contexto de la charla, para no perderlo.

---

## 1. Lo que se implementó (ya en `main`)

| Cambio | Detalle |
|---|---|
| **Actualización automática de la PWA** | El service worker nuevo toma el control apenas se instala (`clientsClaim`, `skipWaiting`), se busca versión nueva al abrir/volver a la app, al recuperar internet y cada 60 s, y la página se recarga sola una vez. Antes F5 mostraba la versión vieja y solo Ctrl+Shift+R traía la nueva. |
| **Borrado en lote de movimientos** | Checkboxes en Movimientos (tabla y tarjetas del celular), barra fija "Eliminar N". `POST /api/movimientos/eliminar-lote` (máx. 200 por vez, mismo camino que el borrado individual → Sheets + Supabase). |
| **Toast con "Deshacer"** | Al crear, editar o eliminar (uno o en lote) movimientos del consultorio. `POST /api/movimientos/restaurar` vuelve a cargar con el ID, fecha y hora originales y no duplica si el ID ya existe. |
| **Agenda en celular** | Cada turno muestra Cobrar + ⋮; el ⋮ abre una hoja desde abajo con Llegó / Canceló / No vino / Editar / Eliminar. En "Sin consultorio asignado" también se puede cancelar o marcar "No vino" ahora. |

### Límites conocidos (a tener en cuenta)

- **Deshacer solo cubre movimientos del consultorio.** Personal, Casa y Agenda
  todavía no lo tienen (usan otros endpoints).
- Un movimiento viejo sin ID único se borra sin botón de deshacer.
- El toast vive en memoria: si se recarga la página, ya no se puede deshacer.
- Al restaurar, `ID_Origen` queda con el usuario actual (la API no lo devuelve);
  el monto en pesos de una edición se restaura de forma proporcional y puede
  variar centavos por redondeo.
- Borrar no tiene deshacer en el bot (`/eliminar`); conviene copiar el Sheet en
  Drive antes de una limpieza grande.
- Los checkboxes y el borrado en lote se probaron con la API simulada, no
  contra Sheets/Supabase reales.
- Una PWA con la versión vieja pegada necesita **una sola vez** desinstalar y
  reinstalar (o borrar los datos del sitio) para recibir el código que se
  actualiza solo.

---

## 2. Bug resuelto: `/profesional` no dejaba registrar odontólogos

- Causa probable (se arregló corriendo el SQL): faltaba la columna
  `profesionales.consultorio`, que crea `sql/migrations/010_profesionales_consultorio.sql`
  (marcada "no se corrió todavía"). Sin ella el guardado falla y el bot responde
  "❌ No se pudo registrar".
- **Deuda:** el repo tiene dos definiciones distintas de `profesionales`
  (`sql/profesionales.sql` y `sql/schema_mvp_odontologia.sql`); conviene dejar
  una sola fuente de verdad.
- **Deuda:** `registrarProfesional` no deja registrado el motivo real del fallo
  (el handler solo muestra el mensaje genérico). Agregar un log del error.
- **Límite de diseño:** `/profesional` registra a **quien lo escribe** y hay un
  profesional por cuenta de Telegram (`telegram_user_id` único). Hoy el admin no
  puede cargar odontólogos a mano.
- Idea: comando/pantalla para que el admin cargue o invite odontólogos sin que
  usen su Telegram (se conecta con la sección 4).

---

## 3. ¿Un chat dentro de la web, como el de Telegram?

**Conclusión:** para la carga rápida diaria, Telegram gana (ya está abierto en
el celu, notifica y tiene botones/fotos/voz). Un chat web solo suma valor si el
objetivo es que alguien **entre sin Telegram** (otros consultorios, recepción).

- Lo reutilizable: parseo NLP (`quick_nlp` / Gemini), guardado
  (`movimiento.service`), el dashboard con su API y login.
- Lo acoplado a Telegram: `text.js`, `nlp.js`, `nlp-confirm.js` (~2.300 líneas,
  ~200 llamadas a `ctx.reply`) y los ~30 comandos con estados conversacionales.
- **Opción A (chica, recomendada para probar):** caja de texto en el dashboard
  que interprete "consulta Juan 15000 efectivo", muestre la tarjeta de
  confirmación y guarde con el flujo de siempre. Orden de días de trabajo.
- **Opción B (completa):** replicar comandos, conversaciones multi-paso, fotos
  y permisos en la web. Bastante más grande y casi todo ya se hace mejor con
  botones/formularios.
- Alternativa barata antes de construir un chat: en "+ Nuevo", una línea de
  texto que complete el formulario ("escribí como en el bot") para confirmar.
- Riesgos: cada acción del chat debe pasar por los mismos chequeos de permisos
  que la API; mantener dos canales duplica pruebas.
- **Pendiente de decidir:** ¿para quién es (vos, odontólogos, otros
  consultorios)? Eso define la prioridad.

---

## 4. Identidad sin Telegram (Etapa 2 de `ARCHITECTURE.md`)

Con "Entrar con Google" el acceso web ya es rápido; lo que lo frena es que
`profiles.id` **es** el ID de Telegram y lo usan Sheets, invitados (`usuarios[]`),
Personal, casas, permisos y el bot. Hoy el alta exige `/start` + `ALLOWED_EMAILS`
(en `.env`, un redeploy para cambiarlo) y Google solo entra si la cuenta se
vinculó antes desde el bot (decisión de seguridad: el email no identifica a nadie).

Opciones para el ID propio (ya listadas en `ARCHITECTURE.md`):

1. **ID negativo para cuentas nuevas:** no choca con los de Telegram y no migra
   nada existente. Más barato y de menor riesgo.
2. **UUID/secuencia para todos:** más limpio a futuro, pero migra ~10
   migraciones de FK y reescribe cómo el bot resuelve a la persona.

Piezas adicionales: alta de cuentas desde la web, vincular Telegram a una cuenta
nacida en la web (enlace de un solo uso), fusión de cuentas duplicadas
(Telegram + Google) y su Personal, e invitar odontólogos por email.

**Recomendación conversada:** empezar por ID negativo + alta con **invitación**
(que el dueño invite a un odontólogo por email, sin Telegram). Eso resuelve el
problema de `/profesional` y no abre el alta a cualquiera con Gmail.
**Pregunta abierta:** ¿alta abierta o solo por invitación? Define el cuidado de
seguridad.

---

## 5. Notificaciones desde la web

Base existente: PWA instalable con service worker y un canal en tiempo real
(`/api/events`, SSE) que hoy solo refresca listas. Hoy las alertas salen por
Telegram (p. ej. `notificarLlegadaPaciente`).

1. **Avisos dentro de la web (campanita + toast):** reutiliza el SSE; fácil;
   solo funciona con la web abierta.
2. **Web Push:** llega con la web cerrada. Requiere claves VAPID, tabla de
   suscripciones por usuario, `web-push` en el servidor, manejador de `push` en
   el service worker y que cada usuario acepte el permiso. Tarea mediana.
   **En iPhone solo funciona con la PWA instalada en la pantalla de inicio
   (iOS 16.4+).** Android y escritorio (Chrome/Edge) andan bien.
3. **Email:** confiable para resúmenes (p. ej. pendientes diarios), lento para
   lo inmediato. Requiere un servicio de envío.
4. **Telegram para alertas + web para gestionar:** lo más simple si se sigue
   usando el bot.

**Recomendación conversada:** mantener las alertas importantes en Telegram y
sumar la campanita para quien trabaja en el dashboard. Pasar a Web Push cuando
haya usuarios sin Telegram, junto con la identidad propia (las suscripciones se
guardan por usuario).
**Pregunta abierta:** qué avisos se quieren (llegada de paciente / turno nuevo →
push; recordatorio de cobros pendientes → email diario).

---

## 6. Ideas y pendientes sueltos

- Deshacer para Personal, Casa y Agenda.
- Checkboxes/borrado en lote en las vistas de Personal y Casa si hace falta.
- Log del error real en `/profesional` y unificar la tabla `profesionales`.
- Hoja de acciones de Agenda: pulir el badge "Pendiente" apretado en
  "Sin consultorio asignado" con nombres largos.
- Mover `ALLOWED_EMAILS` a la base (bloqueante para self-service, ver
  `ARCHITECTURE.md` sección 3).
