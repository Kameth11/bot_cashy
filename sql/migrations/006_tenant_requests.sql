-- Fase 1 multi-tenancy: tabla de solicitudes de acceso
-- Reemplaza ALLOWED_EMAILS del .env — el alta sigue requiriendo aprobación
-- manual pero desde el bot/dashboard, sin editar variables de entorno.

CREATE TABLE IF NOT EXISTS tenant_requests (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT    NOT NULL UNIQUE,
  telegram_user_id BIGINT,
  status        TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by   BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tenant_requests_email    ON tenant_requests(email);
CREATE INDEX IF NOT EXISTS idx_tenant_requests_status   ON tenant_requests(status);
CREATE INDEX IF NOT EXISTS idx_tenant_requests_telegram ON tenant_requests(telegram_user_id);
