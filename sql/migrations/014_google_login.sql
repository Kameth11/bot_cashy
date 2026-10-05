-- =====================================
-- Cashy Bot - Login con Google (etapa 1)
-- =====================================
-- Guarda el identificador estable de Google ("sub") en el perfil para que la
-- persona pueda entrar al dashboard con su cuenta de Google. NO se usa el email
-- para reconocer a nadie: el primer vínculo se confirma desde el bot.
--
-- IDEMPOTENTE. Sin esta columna el botón "Entrar con Google" queda oculto y
-- nada más cambia. Ejecutar manualmente en el SQL editor de Supabase.
-- =====================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS google_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_google_sub
  ON profiles (google_sub) WHERE google_sub IS NOT NULL;
