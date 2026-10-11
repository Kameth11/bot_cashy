-- =====================================
-- Cashy Bot - Invitaciones por email (alta sin Telegram)
-- =====================================
-- Quien tiene el permiso `invitar_personas` (el dueño siempre; otros si el dueño se lo
-- asigna en Accesos) invita a una persona por EMAIL desde el dashboard. La persona entra
-- con "Entrar con Google" con ese mismo email: Google verifica que el email es suyo, el
-- servidor encuentra la invitación pendiente y le crea la cuenta (sin pasar por Telegram)
-- con los permisos que se eligieron al invitar, y opcionalmente la registra como
-- profesional.
--
-- El email SÍ sirve acá como prueba de identidad (a diferencia del email que se tipea en
-- /start): lo escribió a propósito quien invita y lo confirma Google.
--
-- Tabla GLOBAL con tenant_id explícito (se busca por email al entrar, cuando todavía no se
-- sabe de qué consultorio es); el servicio filtra por tenant_id en todo lo que lista, crea o
-- revoca. Solo la lee el service role.
--
-- IDEMPOTENTE. Sin esta tabla el dashboard no ofrece invitar.
-- Ejecutar manualmente en el SQL editor de Supabase.
-- =====================================

CREATE TABLE IF NOT EXISTS invitaciones_web (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  owner_id BIGINT NOT NULL,                 -- dueño del consultorio (clave de profiles/clientes)
  email TEXT NOT NULL,                      -- en minúsculas
  permisos TEXT[] NOT NULL DEFAULT '{}',
  profesional_nombre TEXT,
  profesional_consultorio TEXT,
  creada_por BIGINT NOT NULL,               -- quién invitó (puede ser el dueño u otra persona con permiso)

  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'usada', 'revocada')),
  expira_en TIMESTAMPTZ NOT NULL,
  usada_por BIGINT,
  usada_en TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una sola invitación pendiente por email y consultorio.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitaciones_web_pendiente
  ON invitaciones_web (tenant_id, email) WHERE estado = 'pendiente';

-- La búsqueda al entrar con Google.
CREATE INDEX IF NOT EXISTS idx_invitaciones_web_email ON invitaciones_web (email) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_invitaciones_web_tenant ON invitaciones_web (tenant_id, created_at DESC);

ALTER TABLE invitaciones_web ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS solo_service_role ON invitaciones_web;
CREATE POLICY solo_service_role ON invitaciones_web
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Se registra solo si la 017 ya se corrió (si no, no pasa nada: correr la 017 después).
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    INSERT INTO schema_migrations (version, descripcion) VALUES ('021', 'invitaciones_web: alta por email sin Telegram')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END $$;
