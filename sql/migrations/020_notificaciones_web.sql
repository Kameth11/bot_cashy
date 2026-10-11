-- =====================================
-- Cashy Bot - Notificaciones web (campanita + Web Push)
-- =====================================
-- notificaciones: lo que ve cada persona en la campanita del dashboard (llegada de
--   un paciente, turno nuevo, turno cancelado...). Una fila por aviso.
-- push_subscriptions: los dispositivos/navegadores de cada persona que aceptaron
--   recibir avisos con la web cerrada (Web Push). Una fila por navegador.
--
-- Las dos son PRIVADAS de cada persona (forPersona) y solo las lee el service role.
-- IDEMPOTENTE. Sin estas tablas las notificaciones funcionan igual en memoria
-- (campanita y SSE) pero se pierden en cada deploy y no hay push.
-- Ejecutar manualmente en el SQL editor de Supabase.
-- =====================================

CREATE TABLE IF NOT EXISTS notificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  cuerpo TEXT,
  url TEXT,
  leida BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_user_fecha ON notificaciones (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notificaciones_tenant ON notificaciones (tenant_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- El mismo navegador no se registra dos veces para la misma persona.
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant ON push_subscriptions (tenant_id);

ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS solo_service_role ON notificaciones;
CREATE POLICY solo_service_role ON notificaciones
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS solo_service_role ON push_subscriptions;
CREATE POLICY solo_service_role ON push_subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Se registra solo si la 017 ya se corrió (si no, no pasa nada: correr la 017 después).
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    INSERT INTO schema_migrations (version, descripcion) VALUES ('020', 'notificaciones web: campanita y push_subscriptions')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END $$;
