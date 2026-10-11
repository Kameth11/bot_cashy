-- =====================================
-- Cashy Bot - Telegram vinculado a cuentas nacidas en la web
-- =====================================
-- Una cuenta creada por invitación (migración 021) tiene un ID negativo y ningún Telegram. Si la
-- persona vincula uno desde el dashboard ("Vincular Telegram"), se guarda acá. El bot trata a ese
-- Telegram como la cuenta, y los avisos a la persona salen a ese Telegram.
--
-- Una cuenta ↔ un Telegram, y un Telegram ↔ una cuenta (índice único parcial).
-- IDEMPOTENTE. Sin la columna, vincular Telegram queda deshabilitado (no se rompe nada).
-- Ejecutar manualmente en el SQL editor de Supabase.
-- =====================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_telegram_id ON profiles (telegram_id) WHERE telegram_id IS NOT NULL;

-- Se registra solo si la 017 ya se corrió (si no, no pasa nada: correr la 017 después).
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    INSERT INTO schema_migrations (version, descripcion) VALUES ('022', 'profiles.telegram_id: Telegram vinculado a cuentas web')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END $$;
