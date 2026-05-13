-- =====================================
-- Cashy Bot - Schema para Supabase
-- =====================================
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- =====================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tabla de perfiles de usuario
CREATE TABLE IF NOT EXISTS profiles (
  id BIGINT PRIMARY KEY,
  web_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT,
  display_name TEXT,
  sheet_id TEXT,
  plan TEXT DEFAULT 'free',
  usuarios BIGINT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de movimientos
CREATE TABLE IF NOT EXISTS movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES profiles(id),
  fecha TEXT NOT NULL DEFAULT '',
  hora TEXT DEFAULT '',
  descripcion TEXT NOT NULL DEFAULT '',
  monto NUMERIC NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'Cobrado',
  tipo TEXT NOT NULL DEFAULT 'Ingreso',
  moneda TEXT NOT NULL DEFAULT 'Pesos',
  metodo_pago TEXT DEFAULT '',
  id_unico TEXT DEFAULT '',
  monto_pesos NUMERIC DEFAULT 0,
  id_origen TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_movimientos_user_id ON movimientos(user_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_estado ON movimientos(estado);
CREATE INDEX IF NOT EXISTS idx_movimientos_tipo ON movimientos(tipo);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos(fecha);
CREATE INDEX IF NOT EXISTS idx_movimientos_user_estado ON movimientos(user_id, estado);

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos ENABLE ROW LEVEL SECURITY;

-- Políticas base para el futuro dashboard web.
-- El bot backend puede usar service_role y saltar RLS.

CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (web_user_id = auth.uid());

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (web_user_id = auth.uid());

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (web_user_id = auth.uid());

CREATE POLICY "Users can view own movimientos" ON movimientos
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own movimientos" ON movimientos
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own movimientos" ON movimientos
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own movimientos" ON movimientos
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );
