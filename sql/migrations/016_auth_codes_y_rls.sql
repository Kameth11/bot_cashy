-- =====================================
-- Cashy Bot - auth_codes (códigos de acceso al dashboard) + RLS explícito
-- =====================================
-- 1) auth_codes: el código (src/api/index.js, leerCodigoAuth / request-code /
--    verify) ya la usa como fuente de verdad, pero la tabla NUNCA se creó en
--    producción (verificado 2026-10-10: no aparece entre las tablas de public).
--    Mientras no exista, el código cae al Map en memoria: anda, pero el código
--    pedido se pierde en cada deploy y no lo ve otra instancia, y el error al
--    guardar no queda registrado. Una fila por persona (upsert por
--    telegram_user_id), así que la tabla nunca crece más que la cantidad de
--    usuarios y no necesita limpieza.
--
--    Sin FK a profiles a propósito: el admin original puede pedir un código sin
--    tener perfil, y en desarrollo se permite cualquiera.
--
-- 2) tenants y tenant_requests: en producción ya tienen RLS activo (verificado
--    2026-10-10), pero ningún archivo del repo lo decía. Se deja escrito, igual
--    que ya está para profiles y movimientos (003): solo el service role accede.
--    El backend usa la service role key (que se salta RLS); la política documenta
--    la intención y deja a la anon key sin acceso.
--
-- IDEMPOTENTE: se puede correr varias veces. Depende de set_updated_at()
-- (migración 008). Ejecutar manualmente en el SQL editor de Supabase.
-- =====================================

CREATE TABLE IF NOT EXISTS auth_codes (
  telegram_user_id BIGINT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_auth_codes_updated_at ON auth_codes;
CREATE TRIGGER trg_auth_codes_updated_at
BEFORE UPDATE ON auth_codes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS: solo el service role ────────────────────────────────────────────────

ALTER TABLE auth_codes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS solo_service_role ON auth_codes;
CREATE POLICY solo_service_role ON auth_codes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS solo_service_role ON tenants;
CREATE POLICY solo_service_role ON tenants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS solo_service_role ON tenant_requests;
CREATE POLICY solo_service_role ON tenant_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);
