-- =====================================
-- Cashy Bot - Ámbito personal
-- =====================================
-- Tablas del ámbito de finanzas personales (gastos de la casa, viajes,
-- supermercado, nafta). Son INDEPENDIENTES de `movimientos` y
-- `movimientos_v2`: no se toca su modelo ni su CHECK de categorías.
--
-- Por qué separado: `movimientos_v2` tiene un CHECK con las categorías
-- cerradas del consultorio (consulta, tratamiento, insumos...). Un insert con
-- 'supermercado' lo viola, y ese error queda silenciado en db.service.js, así
-- que la fila terminaría desincronizada sin avisar.
--
-- La fuente de verdad del ámbito personal son las pestañas del Google Sheet
-- del usuario; estas tablas son el dual-write que se activa cuando
-- USE_SUPABASE=true. El código detecta si existen (resolvePersonalCapabilities
-- en personal.service.js) y si no, sigue funcionando solo con Sheets.
--
-- Este script es IDEMPOTENTE: se puede correr varias veces sin error.
-- =====================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Viajes ───────────────────────────────────────────────────────────────────
-- Un viaje agrupa gastos. Vive acá y en la pestaña "Viajes" del Sheet; el
-- "viaje activo" se resuelve por Estado='activo', no por un estado en memoria
-- (un viaje dura días y el proceso se reinicia).

CREATE TABLE IF NOT EXISTS viajes_personales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  legacy_id TEXT,
  nombre TEXT NOT NULL,
  fecha_inicio DATE,
  fecha_fin DATE,
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'cerrado', 'cancelado')),
  presupuesto NUMERIC CHECK (presupuesto IS NULL OR presupuesto >= 0),
  moneda TEXT NOT NULL DEFAULT 'Pesos' CHECK (moneda IN ('Pesos', 'Dólares', 'Euros')),
  notas TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio)
);

-- ── Movimientos personales ───────────────────────────────────────────────────
-- Montos siempre positivos; `tipo_movimiento` marca la dirección. Mismo
-- criterio que v2, para no mezclar signo con semántica.

CREATE TABLE IF NOT EXISTS movimientos_personales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  legacy_id TEXT,
  tipo_movimiento TEXT NOT NULL CHECK (tipo_movimiento IN ('ingreso', 'egreso')),
  categoria TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  comercio TEXT,

  monto_original NUMERIC NOT NULL CHECK (monto_original > 0),
  monto_pesos NUMERIC NOT NULL CHECK (monto_pesos >= 0),
  moneda TEXT NOT NULL DEFAULT 'Pesos' CHECK (moneda IN ('Pesos', 'Dólares', 'Euros')),
  metodo_pago TEXT CHECK (metodo_pago IS NULL OR metodo_pago IN ('efectivo', 'transferencia', 'tarjeta', 'debito', 'otro')),

  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  viaje_id TEXT,
  notas TEXT,
  origen_carga TEXT NOT NULL DEFAULT 'bot' CHECK (origen_carga IN ('bot', 'web', 'sheet', 'migracion')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Categorías cerradas del ámbito personal. Deliberadamente distintas de las
  -- del consultorio: si se agrega una acá, actualizar también
  -- CATEGORIAS_EGRESO_PERSONAL / CATEGORIAS_INGRESO_PERSONAL en
  -- src/services/personal-nlp.service.js.
  CHECK (
    (tipo_movimiento = 'egreso' AND categoria IN (
      'supermercado', 'transporte', 'auto', 'alquiler', 'servicios',
      'expensas', 'salud', 'farmacia', 'educacion', 'entretenimiento',
      'comida_afuera', 'ropa', 'tecnologia', 'mascotas', 'regalos',
      'viajes', 'impuestos', 'otros'
    ))
    OR
    (tipo_movimiento = 'ingreso' AND categoria IN (
      'sueldo', 'alquiler_cobrado', 'freelance', 'otro_ingreso'
    ))
  )
);

-- ── Presupuestos ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS presupuestos_personales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  categoria TEXT NOT NULL,
  monto_mensual NUMERIC NOT NULL CHECK (monto_mensual > 0),
  moneda TEXT NOT NULL DEFAULT 'Pesos' CHECK (moneda IN ('Pesos', 'Dólares', 'Euros')),
  activo BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, categoria)
);

-- ── Triggers (idempotentes: DROP antes de CREATE) ────────────────────────────

DROP TRIGGER IF EXISTS trg_viajes_personales_updated_at ON viajes_personales;
CREATE TRIGGER trg_viajes_personales_updated_at
BEFORE UPDATE ON viajes_personales
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_movimientos_personales_updated_at ON movimientos_personales;
CREATE TRIGGER trg_movimientos_personales_updated_at
BEFORE UPDATE ON movimientos_personales
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_presupuestos_personales_updated_at ON presupuestos_personales;
CREATE TRIGGER trg_presupuestos_personales_updated_at
BEFORE UPDATE ON presupuestos_personales
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Índices ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_movimientos_personales_user_id ON movimientos_personales(user_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_personales_categoria ON movimientos_personales(categoria);
CREATE INDEX IF NOT EXISTS idx_movimientos_personales_fecha ON movimientos_personales(fecha);
CREATE INDEX IF NOT EXISTS idx_movimientos_personales_viaje_id ON movimientos_personales(viaje_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_personales_tipo ON movimientos_personales(tipo_movimiento);
CREATE UNIQUE INDEX IF NOT EXISTS idx_movimientos_personales_legacy_id_unique
  ON movimientos_personales(legacy_id) WHERE legacy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_viajes_personales_user_id ON viajes_personales(user_id);
CREATE INDEX IF NOT EXISTS idx_viajes_personales_estado ON viajes_personales(estado);
CREATE UNIQUE INDEX IF NOT EXISTS idx_viajes_personales_legacy_id_unique
  ON viajes_personales(legacy_id) WHERE legacy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_presupuestos_personales_user_id ON presupuestos_personales(user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Mismo criterio que movimientos_v2: se resuelve el dueño vía profiles.web_user_id.

ALTER TABLE movimientos_personales ENABLE ROW LEVEL SECURITY;
ALTER TABLE viajes_personales ENABLE ROW LEVEL SECURITY;
ALTER TABLE presupuestos_personales ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  op TEXT;
  politica TEXT;
  clausula TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['movimientos_personales', 'viajes_personales', 'presupuestos_personales']
  LOOP
    FOREACH op IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    LOOP
      politica := format('Users can %s own %s', lower(op), t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', politica, t);

      -- INSERT usa WITH CHECK; el resto USING.
      clausula := CASE WHEN op = 'INSERT' THEN 'WITH CHECK' ELSE 'USING' END;

      EXECUTE format(
        'CREATE POLICY %I ON %I FOR %s %s ('
        || 'EXISTS (SELECT 1 FROM profiles p WHERE p.id = user_id AND p.web_user_id = auth.uid())'
        || ')',
        politica, t, op, clausula
      );
    END LOOP;
  END LOOP;
END $$;
