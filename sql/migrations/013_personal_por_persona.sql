-- =====================================
-- Cashy Bot - Personal por persona en Supabase
-- =====================================
-- Prepara las tablas del ámbito personal (migración 008) para que sean la
-- FUENTE DE VERDAD de lo personal, por persona (`user_id`), sin depender del
-- Google Sheet. Hasta que se active PERSONAL_STORE=supabase el bot sigue
-- usando el Sheet y estos cambios no se notan.
--
--   1. created_by: quién cargó cada fila (distinto de user_id: cuando se
--      comparta el Personal, la secretaria carga a nombre del odontólogo).
--   2. hora: la hora de carga que hoy guarda el Sheet.
--   3. origen_carga admite 'dashboard' y 'comprobante' (la API ya mandaba
--      'dashboard' y el CHECK lo rechazaba en silencio).
--   4. preferencias_ambito_personales: la memoria de correcciones de ámbito
--      (hoy vive en la pestaña "Preferencias" del Sheet).
--   5. Un solo viaje activo por persona.
--   6. legacy_id único POR TENANT (antes era global).
--   7. FK a profiles en RESTRICT (antes CASCADE): salir del consultorio o
--      resetear la cuenta ya no puede llevarse por delante el Personal.
--   8. profiles.activo: baja lógica de quien sale pero tiene datos personales.
--
-- Este script es IDEMPOTENTE: se puede correr varias veces sin error.
-- PROPUESTA — no se corrió todavía. Revisar y ejecutar manualmente en el SQL
-- editor de Supabase ANTES de importar datos y de activar PERSONAL_STORE.
-- =====================================

-- ── 1 y 2. Columnas nuevas ───────────────────────────────────────────────────

ALTER TABLE movimientos_personales  ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE viajes_personales       ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE presupuestos_personales ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE movimientos_personales ADD COLUMN IF NOT EXISTS hora TEXT;

-- ── 3. origen_carga ──────────────────────────────────────────────────────────
-- El CHECK de la 008 se creó sin nombre explícito: se busca por su definición.

DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'movimientos_personales'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%origen_carga%'
  LOOP
    EXECUTE format('ALTER TABLE movimientos_personales DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE movimientos_personales
  ADD CONSTRAINT movimientos_personales_origen_carga_check
  CHECK (origen_carga IN ('bot', 'web', 'sheet', 'migracion', 'dashboard', 'comprobante'));

-- ── 4. Preferencias de ámbito ────────────────────────────────────────────────
-- ambito: 'personal' | 'consultorio' | 'casa:<casaId>' (la casa que la persona
-- eligió para ese término).

CREATE TABLE IF NOT EXISTS preferencias_ambito_personales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  termino TEXT NOT NULL CHECK (char_length(termino) BETWEEN 1 AND 80),
  ambito TEXT NOT NULL CHECK (ambito IN ('personal', 'consultorio') OR ambito ~ '^casa:[a-z0-9_]+$'),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, termino)
);

DROP TRIGGER IF EXISTS trg_preferencias_ambito_personales_updated_at ON preferencias_ambito_personales;
CREATE TRIGGER trg_preferencias_ambito_personales_updated_at
BEFORE UPDATE ON preferencias_ambito_personales
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_preferencias_ambito_personales_tenant_user
  ON preferencias_ambito_personales (tenant_id, user_id);

ALTER TABLE preferencias_ambito_personales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS solo_service_role ON preferencias_ambito_personales;
CREATE POLICY solo_service_role ON preferencias_ambito_personales
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 5. Un solo viaje activo por persona ──────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_viajes_personales_un_activo_por_persona
  ON viajes_personales (user_id) WHERE estado = 'activo';

-- ── 6. legacy_id único por tenant (no global) ────────────────────────────────

DROP INDEX IF EXISTS idx_movimientos_personales_legacy_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_movimientos_personales_tenant_legacy_id
  ON movimientos_personales (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL;

DROP INDEX IF EXISTS idx_viajes_personales_legacy_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_viajes_personales_tenant_legacy_id
  ON viajes_personales (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL;

-- ── 7. FK a profiles en RESTRICT ─────────────────────────────────────────────
-- Con Supabase como única fuente, un DELETE de profiles (salir del consultorio,
-- /reiniciar) con CASCADE se llevaría todo el Personal de la persona.

ALTER TABLE movimientos_personales  DROP CONSTRAINT IF EXISTS movimientos_personales_user_id_fkey;
ALTER TABLE movimientos_personales  ADD  CONSTRAINT movimientos_personales_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE viajes_personales       DROP CONSTRAINT IF EXISTS viajes_personales_user_id_fkey;
ALTER TABLE viajes_personales       ADD  CONSTRAINT viajes_personales_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE presupuestos_personales DROP CONSTRAINT IF EXISTS presupuestos_personales_user_id_fkey;
ALTER TABLE presupuestos_personales ADD  CONSTRAINT presupuestos_personales_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

-- ── 8. Baja lógica en profiles ───────────────────────────────────────────────
-- profiles es el registro de clientes (cargarClientes lee todas las filas). Quien
-- sale del consultorio pero tiene Personal se marca activo=false en vez de borrarse.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
