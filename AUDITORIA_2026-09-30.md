# Auditoría de escalabilidad, arquitectura y seguridad — 2026-09-30

> Hallazgos pendientes. Cuando se cierre uno, tildarlo acá y, si fue una
> decisión de fondo, sumarlo al ADR de `ARCHITECTURE.md` sección 8.
> Contexto general y plan multi-tenant: `ARCHITECTURE.md`.

**Alcance:** revisión de código sobre `main` (commit `5d0254c`), sin cambios de
código. Estado al momento: 648/648 tests verdes, `check:tenant` OK.
**Veredicto:** apto para 1–3 consultorios en una instancia. Los ítems 1–4 hay
que cerrarlos antes de venderle a un tercero.

Leyenda de confianza: **[V]** verificado (corrida o lectura directa),
**[?]** hay que confirmarlo fuera del repo (config de Supabase/Google/Railway).

---

## Crítico / alto

- [x] **1. Rate limiters compartidos entre todos los usuarios** **[V]**
  `src/api/index.js` limita por `req.ip` y nunca hace `app.set('trust proxy', …)`.
  Probado localmente: con `X-Forwarded-For: 203.0.113.9`, `req.ip` sigue siendo
  `127.0.0.1`. Detrás de Railway todos comparten la IP del proxy, así que el
  límite de 120 req/min es global, y los de `/api/auth/request-code` (20/10 min)
  y `/api/auth/verify` (30/10 min) también. Además `requestCodeByUser` (5/10 min
  por Telegram ID, sin autenticar) permite bloquear el login de otra persona.
  **Resuelto (2026-09-30):** `app.set('trust proxy', TRUST_PROXY_HOPS ?? 1)` +
  `tests/api.trust-proxy.test.js` (falla sin el fix). Pendiente **[?]**: confirmar
  que Railway agrega exactamente 1 salto; si no, setear `TRUST_PROXY_HOPS`.

- [ ] **2. Lecturas de historial completo; el tope de 20.000 puede ser 1.000** **[V]/[?]**
  `fetchLegacyRowsForUser` usa `.limit(20000)`, pero el `max-rows` por defecto de
  PostgREST en Supabase es 1000 y gana sobre `.limit()`. Si no se subió,
  balances y dashboard se truncan en silencio **[?]** (Supabase → Settings → API
  → Max rows).
  Aunque el tope sea real: `updateMovimiento`/`deleteMovimiento`/`findRowByIdUnico`
  cargan todas las filas y buscan en memoria; `/api/movimientos` no pagina;
  balances y `/hoy`/`/semana` se calculan en memoria sobre todo el historial.
  *Arreglo:* consultas `.eq('id_unico', …)`, filtros por rango de fechas y
  agregados en SQL, paginación.

- [ ] **3. Google Sheets como cuello de botella** **[V]/[?]**
  Cuota de Google ≈ 60 req/min por usuario y por proyecto, y todos los tenants
  usan la misma service account **[?]**. Cada escritura cuesta 2–3 llamadas
  (`ensureSheetStructure` hace `loadHeaderRow` en cada `addRow`, más el `addRow`
  y el color). Sin retry/backoff ante 429 en ningún servicio (solo Gemini lo
  maneja). El dual-write en background falla solo con `console.error`: el
  respaldo puede divergir sin aviso. Agenda/personal/comprobantes leen la
  pestaña entera con `getRows()` sin cache (Turnos crece sin límite). Con
  `USE_SUPABASE=false` Sheets es la ruta primaria y el techo baja mucho.
  *Arreglo:* backoff con reintentos, cola/reconciliación del respaldo, no
  llamar `ensureSheetStructure` en cada escritura, cachear/acotar lecturas.

- [ ] **4. Ciclo de vida del proceso e instancia única** **[V]**
  - Sin apagado ordenado: en SIGTERM solo `bot.stop`. No se cierra el servidor
    HTTP ni se vacía la cola de `runInBackground` → un deploy puede perder
    escrituras de respaldo a Sheets en vuelo.
  - Deploy con solapamiento → `409 Conflict` de Telegram (polling doble).
  - Códigos de login primero en `global._authCodes` (memoria), después Supabase:
    con 2 réplicas verifican distinto.
  - No hay `/health` ni healthcheck en `railway.json`.
  - Con `USE_SUPABASE=false`, `clientes.json` se pierde en cada deploy.
  - (Ya documentado en `ARCHITECTURE.md` §6: write-lock en memoria, Redis.)

## Medio

- [x] **5. `PUT /api/movimientos/:id` sin validar** **[V]**
  `descripcion` no pasa por `sanitizarInput` (sin tope de largo ni prefijo `'`
  anti-fórmula, que el POST sí aplica); `monto` acepta `NaN`; **no se recalcula
  `MontoPesos`** al cambiar monto o moneda → balances inconsistentes tras editar.

- [ ] **6. Registro de sheet sin verificar dueño** **[V, por lectura]**
  `handleSheetIdStep` (`registration.service.js`) no chequea que el `sheetId` no
  pertenezca ya a otro dueño, y `resolveOrCreateTenantId` agrupa por `sheet_id`:
  registrar el ID de otro consultorio deja al usuario dentro de ese tenant. Lo
  mitiga la aprobación manual y la dificultad de adivinar el ID. Cerrar antes de
  self-service. No se explotó, solo se leyó el flujo.

- [ ] **7. Puntos ciegos del guard de aislamiento** **[V]**
  `scripts/check-tenant-isolation.js` busca `getSupabase().from(...)`; las
  consultas a `movimientos_v2` usan `supabase.from(...)` con variable y no las
  detecta. Además se filtran por `user_id`, no `tenant_id`. Hoy esas tablas no
  existen en producción; tratarlo cuando se activen v2.

- [ ] **8. JWT de 180 días con renovación deslizante** **[V]**
  Sin revocación, en `localStorage`; en la práctica no vence mientras se use.
  Ya figura como pendiente en `ARCHITECTURE.md` §4.

- [ ] **9. Sin cuota de IA por tenant** **[V]**
  Solo hay 12 mensajes/10 s por usuario. Nada diario ni atribución de costo por
  tenant; cualquier invitado puede consumir Gemini/OpenRouter.

- [~] **10. Dependencias vulnerables** **[V, `npm audit` del 2026-09-30]**
  Raíz: 10 vulns (4 altas): `sharp`/libvips (procesa imágenes de usuarios),
  `ws`, `uuid`/`gaxios`. `npm audit fix` cubre la mayoría; `sharp` pide salto
  mayor (0.35.x). Dashboard: 4 (3 altas), todas en `react-router`.
  **Parcial (2026-09-30):** `npm audit fix` sin cambios mayores → raíz 10→5.
  Quedan `sharp` (salto mayor, probar con fotos reales), `@supabase/supabase-js`
  (fijado en 2.49.1) y `uuid`/`gaxios` (vía google-spreadsheet): requieren `--force`.

- [ ] **11. CI no bloquea el deploy** **[V]**
  Decisión documentada para un solo desarrollador; su disparador es "primer
  cliente externo pago".

## Bajo

- [ ] Maps que nunca se limpian: `userRateLimits`, `hits` de los limiters,
  `_authCodes`, `_movCache`.
- [ ] SSE sin tope de conexiones por usuario.
- [ ] `request-code` responde distinto (403/200) según exista el usuario →
  enumeración de IDs de Telegram.
- [ ] Carrera en la marca `used` de la verificación de código.
- [ ] Archivos muy grandes: `db.service` (1345), `command.service` (1257),
  `api/index.js` (1111, todas las rutas), `text.js` (1038), `quick_nlp` (1054).
- [ ] `@supabase/supabase-js` con anon key en el bundle del dashboard sin uso.

---

## Pendientes a cargo del dueño (preguntarle en cada sesión hasta que los confirme)
- [ ] Supabase → Settings → API → **Max rows**: ¿está en 1000? (ítem 2)
- [ ] Railway: ¿agrega exactamente 1 salto de proxy? Si no, setear `TRUST_PROXY_HOPS` (ítem 1)

## Orden sugerido
1. **Ya:** ítem 1 (`trust proxy`), verificar `max-rows` (2), ítem 5, `npm audit fix` (10).
2. **Antes del 2.º cliente:** consultas por id/rango (2), retry + reconciliación
   de Sheets (3), apagado ordenado + `/health` (4), unicidad de `sheetId` (6).
3. **Antes de cobrar:** CI bloqueante (11), cuota de IA (9), JWT corto con
   revocación (8); Redis/réplicas solo si hace falta.

## Por qué no aparecieron en la revisión del 2026-09-23/24
Ver `git log` de esas fechas y `ARCHITECTURE.md` §4 y §8: aquella revisión fue
de **autorización e integridad de datos** (quién ve/hace qué, invitados, tenant,
zona horaria, Markdown). Estos hallazgos son de **comportamiento en producción**
(proxy, cuotas externas, ciclo de vida) o de **caminos paralelos** que el
arreglo puntual no barrió (el `PUT` frente al `POST`). Los tests no los cubren
porque ejecutan el código sin proxy ni límites externos.
