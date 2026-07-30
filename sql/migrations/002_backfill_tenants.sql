-- =====================================
-- Fase 2 multi-tenancy (PR 3 de 5)
-- Backfill: crear un tenant por cada consultorio real existente y
-- propagar tenant_id a movimientos y profesionales.
--
-- Hoy hay 2 tenants reales (confirmado contra produccion 2026-06-24):
--   - Consultorio principal: profiles.id 1419810344 (owner/admin) +
--     8321573327 (invitado), comparten el mismo sheet_id.
--   - verolincoln@gmail.com: profiles.id 6279333302, sheet_id propio.
-- Se escribe a mano (no generico) porque son pocos datos conocidos y
-- evita ambiguedad de agrupar por sheet_id/nombre con matching fragil.
-- Nuevos tenants futuros se crean en el momento del onboarding (PR 4),
-- no via backfill.
-- =====================================

-- Tenant 1: consultorio principal
WITH t1 AS (
  INSERT INTO tenants (nombre) VALUES ('Consultorio principal')
  RETURNING id
)
UPDATE profiles
SET tenant_id = (SELECT id FROM t1)
WHERE id IN (1419810344, 8321573327)
  AND tenant_id IS NULL;

-- Tenant 2: verolincoln
WITH t2 AS (
  INSERT INTO tenants (nombre) VALUES ('verolincoln@gmail.com')
  RETURNING id
)
UPDATE profiles
SET tenant_id = (SELECT id FROM t2)
WHERE id = 6279333302
  AND tenant_id IS NULL;

-- Propagar a movimientos via user_id -> profiles.id
UPDATE movimientos m
SET tenant_id = p.tenant_id
FROM profiles p
WHERE m.user_id = p.id
  AND m.tenant_id IS NULL;

-- Propagar a profesionales: telegram_user_id puede ser el owner
-- (profiles.id) o un invitado (profiles.usuarios[]).
UPDATE profesionales pr
SET tenant_id = p.tenant_id
FROM profiles p
WHERE pr.tenant_id IS NULL
  AND (
    p.id = pr.telegram_user_id::bigint
    OR pr.telegram_user_id::bigint = ANY(p.usuarios)
  );

-- Validacion: las 3 deben dar 0 antes de seguir a PR4.
SELECT
  (SELECT count(*) FROM profiles WHERE tenant_id IS NULL) AS profiles_sin_tenant,
  (SELECT count(*) FROM movimientos WHERE tenant_id IS NULL) AS movimientos_sin_tenant,
  (SELECT count(*) FROM profesionales WHERE tenant_id IS NULL) AS profesionales_sin_tenant;
