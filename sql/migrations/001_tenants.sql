-- =====================================
-- Fase 2 multi-tenancy (PR 1 de 5)
-- Tabla tenants + columnas tenant_id nullable.
-- No rompe nada: todo es ADD COLUMN nullable / CREATE TABLE nueva.
-- Solo toca tablas confirmadas en produccion: profiles, movimientos,
-- profesionales. movimientos_v2/movimiento_eventos_v2/obras_sociales/
-- prestaciones son esquemas draft que nunca se crearon (ver
-- schema_v2_draft.sql / schema_mvp_odontologia.sql) - se agregan en
-- una migracion aparte si/cuando se activen.
-- =====================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE profesionales ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_tenant ON movimientos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_profesionales_tenant ON profesionales(tenant_id);
