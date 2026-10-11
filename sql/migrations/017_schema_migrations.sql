-- =====================================
-- Cashy Bot - Registro de migraciones (schema_migrations)
-- =====================================
-- Hasta acá las migraciones se corrían a mano y no quedaba registro de cuáles
-- estaban aplicadas (había que deducirlo con sql/verificar_estado.sql). Esta
-- tabla lo deja escrito.
--
-- CONVENCIÓN: cada migración nueva se inserta a sí misma al final:
--   INSERT INTO schema_migrations (version, descripcion) VALUES ('018', '...')
--   ON CONFLICT (version) DO NOTHING;
--
-- IMPORTANTE: el bloque de abajo registra 001..017 como aplicadas. Es correcto
-- en una base nueva (donde se corrieron todas en orden) y en producción SOLO si
-- sql/verificar_estado.sql da todo en `true` (paso 0.2 de PLAN_BASE_DE_DATOS.md).
-- Si alguna da `false`, correr primero esa migración y recién después esta.
--
-- IDEMPOTENTE. Solo el service role accede (RLS).
-- =====================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  descripcion TEXT NOT NULL,
  aplicada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS solo_service_role ON schema_migrations;
CREATE POLICY solo_service_role ON schema_migrations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO schema_migrations (version, descripcion) VALUES
  ('001', 'tenants y tenant_id en movimientos'),
  ('002', 'backfill de tenants'),
  ('003', 'tenant_id obligatorio'),
  ('004', 'índices por tenant'),
  ('005', 'movimientos.fecha_cobro'),
  ('006', 'tenant_requests'),
  ('007', 'permisos granulares'),
  ('008', 'movimientos personales'),
  ('009', 'modo full IA'),
  ('010', 'consultorio por profesional'),
  ('011', 'comprobantes'),
  ('012', 'casas compartidas'),
  ('013', 'Personal por persona'),
  ('014', 'login con Google'),
  ('015', 'chat_historial'),
  ('016', 'auth_codes y RLS explícito'),
  ('017', 'registro de migraciones')
ON CONFLICT (version) DO NOTHING;

-- 018 y 019 se pueden haber corrido ANTES que esta: se registran solo si realmente están.
INSERT INTO schema_migrations (version, descripcion)
SELECT '018', 'movimientos.fecha_iso (DATE) con trigger'
WHERE EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'movimientos' AND column_name = 'fecha_iso')
ON CONFLICT (version) DO NOTHING;

INSERT INTO schema_migrations (version, descripcion)
SELECT '019', 'restricciones estado/tipo/moneda en movimientos (NOT VALID)'
WHERE EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimientos_estado_chk')
ON CONFLICT (version) DO NOTHING;
