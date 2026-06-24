-- =====================================
-- Fase 2 multi-tenancy (PR 5 de 5)
-- Endurecer: tenant_id obligatorio + RLS defensiva.
-- Solo correr despues de confirmar que PR4 funciona bien en produccion
-- (verificado 2026-06-24: 0 filas sin tenant_id en profiles, movimientos
-- y profesionales).
-- =====================================

ALTER TABLE profiles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE movimientos ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE profesionales ALTER COLUMN tenant_id SET NOT NULL;

-- profesionales ya tiene "Service role full access" (sql/profesionales.sql),
-- no se toca. profiles/movimientos tienen policies vestigiales basadas en
-- auth.uid() (sql/schema.sql) que nunca se ejecutaron porque el backend
-- siempre usa la service_role_key - se reemplazan por una policy explicita
-- que documenta la realidad: solo service_role puede tocar estas tablas.

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view own movimientos" ON movimientos;
DROP POLICY IF EXISTS "Users can insert own movimientos" ON movimientos;
DROP POLICY IF EXISTS "Users can update own movimientos" ON movimientos;
DROP POLICY IF EXISTS "Users can delete own movimientos" ON movimientos;

CREATE POLICY "solo_service_role" ON profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "solo_service_role" ON movimientos
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
