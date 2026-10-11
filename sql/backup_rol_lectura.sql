-- =====================================
-- Cashy Bot - Rol de SOLO LECTURA para el respaldo automático
-- =====================================
-- El respaldo (GitHub Actions, ver RESPALDOS.md) guarda la clave de este rol, no la
-- del dueño de la base: si esa clave se filtrara, solo se podrían LEER los datos.
--
-- ANTES DE CORRER: cambiar 'CAMBIAR_ESTA_CLAVE' por una clave larga y aleatoria
-- (la misma que después va a la variable SUPABASE_DB_URL de GitHub). No commitear
-- la clave real.
--
-- Por qué las políticas: todas las tablas tienen RLS y el rol no se salta RLS, así
-- que sin una política que le permita leer, el volcado saldría VACÍO sin error.
-- IDEMPOTENTE. VOLVER A CORRER este archivo cada vez que se cree una tabla nueva
-- (el respaldo falla a propósito, avisando, si encuentra una sin política).
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backup_ro') THEN
    CREATE ROLE backup_ro LOGIN PASSWORD 'CAMBIAR_ESTA_CLAVE';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO backup_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_ro;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO backup_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO backup_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO backup_ro;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS backup_lectura ON public.%I', t.tablename);
    EXECUTE format('CREATE POLICY backup_lectura ON public.%I FOR SELECT TO backup_ro USING (true)', t.tablename);
  END LOOP;
END $$;
