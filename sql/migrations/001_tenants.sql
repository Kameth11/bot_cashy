-- =====================================
-- Fase 2 multi-tenancy (PR 1 de 5)
-- Tabla tenants + columnas tenant_id nullable.
-- No rompe nada: todo es ADD COLUMN nullable / CREATE TABLE nueva.
-- Ver ARCHITECTURE.md seccion 3 y plan en
-- /home/matias/.claude/plans/podemos-usar-el-ci-bubbly-quokka.md
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

-- movimientos_v2 / movimiento_eventos_v2 / obras_sociales / prestaciones /
-- profesionales son tablas que viven en schema_v2_draft.sql /
-- schema_mvp_odontologia.sql / profesionales.sql. Pueden no existir todavia
-- en todos los entornos (son opcionales/draft), por eso se valida con
-- to_regclass antes de alterarlas.
DO $$
BEGIN
  IF to_regclass('public.movimientos_v2') IS NOT NULL THEN
    ALTER TABLE movimientos_v2 ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  END IF;
  IF to_regclass('public.movimiento_eventos_v2') IS NOT NULL THEN
    ALTER TABLE movimiento_eventos_v2 ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  END IF;
  IF to_regclass('public.profesionales') IS NOT NULL THEN
    ALTER TABLE profesionales ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  END IF;
  IF to_regclass('public.obras_sociales') IS NOT NULL THEN
    ALTER TABLE obras_sociales ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  END IF;
  IF to_regclass('public.prestaciones') IS NOT NULL THEN
    ALTER TABLE prestaciones ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_tenant ON movimientos(tenant_id);

DO $$
BEGIN
  IF to_regclass('public.movimientos_v2') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_movimientos_v2_tenant ON movimientos_v2(tenant_id);
  END IF;
  IF to_regclass('public.movimiento_eventos_v2') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_movimiento_eventos_v2_tenant ON movimiento_eventos_v2(tenant_id);
  END IF;
  IF to_regclass('public.profesionales') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_profesionales_tenant ON profesionales(tenant_id);
  END IF;
  IF to_regclass('public.obras_sociales') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_obras_sociales_tenant ON obras_sociales(tenant_id);
  END IF;
  IF to_regclass('public.prestaciones') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_prestaciones_tenant ON prestaciones(tenant_id);
  END IF;
END $$;
