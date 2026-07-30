-- =====================================
-- Optimización de lecturas (Fase 1.2)
-- Índice que matchea el patrón real de lectura de movimientos:
--   WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT N
-- (ver fetchLegacyRowsForUser en src/services/db.service.js).
-- Sin esto, con muchas filas Postgres hace un scan + sort en cada fetch del
-- dashboard. Correr en el SQL Editor de Supabase.
-- =====================================

CREATE INDEX IF NOT EXISTS idx_movimientos_tenant_user_created
  ON movimientos (tenant_id, user_id, created_at DESC);
