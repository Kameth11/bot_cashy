# Próximos pasos — traspaso de contexto (2026-10-11)

Para arrancar una conversación nueva sin cargar la anterior: leer este archivo y
`CLAUDE.md` (se carga solo). El detalle está en `PLAN_BASE_DE_DATOS.md` y en la
sección 7 de `NOTAS_2026-10-09_WEB_IDENTIDAD_NOTIFICACIONES.md`.

## Dónde estamos
- Todo está en `main` y desplegado por Railway. 1474 tests pasan (`npm test`) y
  `npm run check:tenant` está en verde.
- **Hecho**: chat web completo dentro del dashboard (texto, audio, fotos/PDF, cola
  sin conexión, historial persistente, también en Personal y Casa); arreglos de
  audio cortado y grabadora colgada; migraciones 015 (chat_historial) y 016
  (auth_codes + RLS); `sql/verificar_estado.sql`; plan de base de datos y
  comparación de proveedores.
- La base de Supabase es del plan **gratuito** y por ahora no se va a pagar.

## Lo que tiene que hacer el usuario (Claude no puede)
1. Correr `sql/migrations/016_auth_codes_y_rls.sql` en Supabase y después
   `sql/verificar_estado.sql` (todo debería dar `true`).
2. Probar en producción: audio largo con nombre + monto + método; foto de factura y
   de transferencia; gasto de Casa y uno personal. Si el audio sale cortado, mirar
   el log de Railway (línea "transcripcion de audio … termino con …").
3. Confirmar que Railway tenga `SUPABASE_SERVICE_ROLE_KEY`.
4. **Respaldo automático** (ya armado, falta activarlo): seguir `RESPALDOS.md` — crear el
   rol de solo lectura (`sql/backup_rol_lectura.sql`), cargar los secretos
   `SUPABASE_DB_URL` y `BACKUP_PASSPHRASE` en GitHub, hacer la primera corrida a mano y
   probar una restauración. Hasta que lo hagas, el workflow diario falla a propósito.

## Qué sigue (en este orden)
1. **Respaldo de los archivos del bucket `comprobantes`** (el de la base ya está armado,
   ver `RESPALDOS.md`): hace falta confirmar si se usa Supabase Storage o solo la copia por
   Telegram, y si se usa, bajarlos con un script (requiere la service role key en GitHub, o
   un almacenamiento aparte).
2. **Fase 1 de `PLAN_BASE_DE_DATOS.md`**: registro de migraciones (017), prueba de
   las migraciones contra un Postgres real en CI, mirar `.error` en `auth_codes`,
   avisar si falta la service role key, limpiar `sql/` y el código muerto de
   Supabase en el dashboard.
3. **Dockerfile** para no depender de Railway (sección 7 del plan).
4. Fase 2 (fechas reales y restricciones en `movimientos`), fase 3 (reconciliar
   Sheets ↔ Supabase), fase 4 (SaaS) — solo si se decide vender pronto.
5. Pendientes de producto: app en tiendas (Android primero; ver notas), push, login
   sin Telegram, deshacer en Personal/Casa/Agenda.

## Decisiones abiertas del usuario
- ¿Se vende a otros consultorios pronto? (sube la prioridad de la fase 4)
- ¿El repo es privado? (la migración 002 tiene IDs de Telegram y un email reales)
- Clave de servicio: ¿solo avisar si falta, o negarse a arrancar en producción?
- ¿Agregar `fecha_iso` y restricciones a `movimientos`, previa copia de seguridad?

## Cómo trabajar (para el asistente)
- Push directo a `main` está permitido (decisión del proyecto); rama de la sesión
  `claude/inspiring-allen-go00dw`. Commits con las líneas de atribución.
- **No se tocan los tests por ahora** (decisión del usuario).
- No se puede probar acá: Gemini real, Supabase real ni Google Sheets reales (no hay
  claves). Sí se puede: handlers reales con un server de prueba + Playwright
  (global: `$(npm root -g)/playwright`), y SQL contra un Postgres 16 local
  (`/usr/lib/postgresql/16/bin`; el directorio de datos va en `/var/lib/postgresql`,
  no en la carpeta de trabajo, y se borra al terminar).
- Trampas conocidas: `pkill -f <patrón>` se mata a sí mismo si el patrón aparece en el
  propio comando; `dashboard/dist` está versionado y un `npm run build` lo modifica
  (restaurarlo con `git checkout -- dashboard/dist` antes de commitear); no dejar
  archivos sueltos de pruebas en la raíz.

## Archivos clave
`src/lib/canal-web.js` (chat web) · `src/api/chat.routes.js` ·
`dashboard/src/components/ChatWidget.jsx` · `src/services/chat-historial.service.js` ·
`sql/migrations/` · `sql/verificar_estado.sql` · `PLAN_BASE_DE_DATOS.md` ·
`ARCHITECTURE.md` · `NOTAS_2026-10-09_WEB_IDENTIDAD_NOTIFICACIONES.md`
