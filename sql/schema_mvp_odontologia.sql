-- =====================================
-- Cashy Bot - MVP Odontologia
-- =====================================
-- Ejecutar en Supabase SQL Editor.
--
-- IMPORTANTE:
-- - Este script agrega tablas del dominio odontologico.
-- - Tambien adapta `movimientos` para soportar el MVP.
-- - Debe desplegarse junto con la version de codigo que
--   ya tolera `fecha` como DATE, `tipo` en minuscula y
--   `medio_pago` / `referencia_id`.
-- =====================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS profesionales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  especialidad TEXT NOT NULL,
  porcentaje_honorarios NUMERIC(5,2) NOT NULL
    CHECK (porcentaje_honorarios >= 0 AND porcentaje_honorarios <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, nombre)
);

DROP TRIGGER IF EXISTS trg_profesionales_updated_at ON profesionales;
CREATE TRIGGER trg_profesionales_updated_at
BEFORE UPDATE ON profesionales
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS obras_sociales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  dias_acreditacion_promedio INTEGER NOT NULL
    CHECK (dias_acreditacion_promedio >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, nombre)
);

DROP TRIGGER IF EXISTS trg_obras_sociales_updated_at ON obras_sociales;
CREATE TRIGGER trg_obras_sociales_updated_at
BEFORE UPDATE ON obras_sociales
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS prestaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  fecha_prestacion DATE NOT NULL,
  fecha_cobro DATE,
  paciente TEXT NOT NULL,
  profesional_id UUID NOT NULL REFERENCES profesionales(id) ON DELETE RESTRICT,
  obra_social_id UUID REFERENCES obras_sociales(id) ON DELETE SET NULL,
  descripcion TEXT NOT NULL,
  monto_pactado NUMERIC(12,2) NOT NULL CHECK (monto_pactado > 0),
  monto_cobrado NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monto_cobrado >= 0),
  tipo_cobro TEXT NOT NULL CHECK (tipo_cobro IN ('particular', 'obra_social', 'mixto')),
  estado_cobro TEXT NOT NULL CHECK (estado_cobro IN ('cobrado', 'pendiente', 'presentado_os', 'rechazado')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (monto_cobrado <= monto_pactado)
);

DROP TRIGGER IF EXISTS trg_prestaciones_updated_at ON prestaciones;
CREATE TRIGGER trg_prestaciones_updated_at
BEFORE UPDATE ON prestaciones
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE movimientos
  ADD COLUMN IF NOT EXISTS categoria TEXT,
  ADD COLUMN IF NOT EXISTS medio_pago TEXT,
  ADD COLUMN IF NOT EXISTS referencia_id UUID;

UPDATE movimientos
SET medio_pago = NULLIF(metodo_pago, '')
WHERE medio_pago IS NULL;

ALTER TABLE movimientos
  ALTER COLUMN fecha DROP DEFAULT,
  ALTER COLUMN fecha TYPE DATE
  USING CASE
    WHEN fecha ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(fecha, 'DD/MM/YYYY')
    WHEN fecha ~ '^\d{4}-\d{2}-\d{2}$' THEN fecha::DATE
    ELSE NULL
  END,
  ALTER COLUMN tipo DROP DEFAULT,
  ALTER COLUMN tipo TYPE TEXT
  USING lower(tipo),
  ALTER COLUMN tipo SET DEFAULT 'ingreso';

ALTER TABLE movimientos
  DROP CONSTRAINT IF EXISTS movimientos_tipo_check;

ALTER TABLE movimientos
  ADD CONSTRAINT movimientos_tipo_check
  CHECK (tipo IN ('ingreso', 'egreso'));

ALTER TABLE movimientos
  DROP CONSTRAINT IF EXISTS movimientos_medio_pago_check;

ALTER TABLE movimientos
  ADD CONSTRAINT movimientos_medio_pago_check
  CHECK (
    medio_pago IS NULL OR
    medio_pago IN ('efectivo', 'transferencia', 'tarjeta', 'obra_social', 'otro')
  );

ALTER TABLE movimientos
  DROP CONSTRAINT IF EXISTS movimientos_referencia_id_fkey;

ALTER TABLE movimientos
  ADD CONSTRAINT movimientos_referencia_id_fkey
  FOREIGN KEY (referencia_id)
  REFERENCES prestaciones(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profesionales_user_id
  ON profesionales(user_id);

CREATE INDEX IF NOT EXISTS idx_profesionales_especialidad
  ON profesionales(especialidad);

CREATE INDEX IF NOT EXISTS idx_obras_sociales_user_id
  ON obras_sociales(user_id);

CREATE INDEX IF NOT EXISTS idx_prestaciones_user_id
  ON prestaciones(user_id);

CREATE INDEX IF NOT EXISTS idx_prestaciones_fecha_prestacion
  ON prestaciones(fecha_prestacion);

CREATE INDEX IF NOT EXISTS idx_prestaciones_fecha_cobro
  ON prestaciones(fecha_cobro);

CREATE INDEX IF NOT EXISTS idx_prestaciones_profesional_id
  ON prestaciones(profesional_id);

CREATE INDEX IF NOT EXISTS idx_prestaciones_obra_social_id
  ON prestaciones(obra_social_id);

CREATE INDEX IF NOT EXISTS idx_prestaciones_estado_cobro
  ON prestaciones(estado_cobro);

CREATE INDEX IF NOT EXISTS idx_movimientos_categoria
  ON movimientos(categoria);

CREATE INDEX IF NOT EXISTS idx_movimientos_medio_pago
  ON movimientos(medio_pago);

CREATE INDEX IF NOT EXISTS idx_movimientos_referencia_id
  ON movimientos(referencia_id);

ALTER TABLE profesionales ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras_sociales ENABLE ROW LEVEL SECURITY;
ALTER TABLE prestaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profesionales" ON profesionales;
CREATE POLICY "Users can view own profesionales" ON profesionales
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own profesionales" ON profesionales;
CREATE POLICY "Users can insert own profesionales" ON profesionales
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own profesionales" ON profesionales;
CREATE POLICY "Users can update own profesionales" ON profesionales
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete own profesionales" ON profesionales;
CREATE POLICY "Users can delete own profesionales" ON profesionales
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view own obras_sociales" ON obras_sociales;
CREATE POLICY "Users can view own obras_sociales" ON obras_sociales
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own obras_sociales" ON obras_sociales;
CREATE POLICY "Users can insert own obras_sociales" ON obras_sociales
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own obras_sociales" ON obras_sociales;
CREATE POLICY "Users can update own obras_sociales" ON obras_sociales
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete own obras_sociales" ON obras_sociales;
CREATE POLICY "Users can delete own obras_sociales" ON obras_sociales
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view own prestaciones" ON prestaciones;
CREATE POLICY "Users can view own prestaciones" ON prestaciones
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own prestaciones" ON prestaciones;
CREATE POLICY "Users can insert own prestaciones" ON prestaciones
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own prestaciones" ON prestaciones;
CREATE POLICY "Users can update own prestaciones" ON prestaciones
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete own prestaciones" ON prestaciones;
CREATE POLICY "Users can delete own prestaciones" ON prestaciones
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

COMMIT;
