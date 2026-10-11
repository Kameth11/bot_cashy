-- =====================================
-- Cashy Bot - Schema V2 Draft
-- =====================================
-- Propuesta tecnica para evolucionar el modelo financiero
-- sin reemplazar todavia el schema operativo actual.
--
-- Objetivo del draft:
-- - montos positivos con tipo_movimiento explicito
-- - categorias cerradas para MVP
-- - saldo_pendiente estructurado
-- - eventos separados para cobros/pagos parciales
-- =====================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS movimientos_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  tipo_movimiento TEXT NOT NULL CHECK (tipo_movimiento IN ('ingreso', 'egreso')),
  categoria TEXT NOT NULL,
  subcategoria TEXT,
  estado_pago TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_pago IN ('pendiente', 'parcial', 'cobrado', 'pagado', 'vencido', 'cancelado')),

  descripcion TEXT NOT NULL DEFAULT '',
  paciente_nombre TEXT,
  profesional_nombre TEXT,
  proveedor_nombre TEXT,
  tratamiento_nombre TEXT,

  metodo_pago TEXT CHECK (metodo_pago IS NULL OR metodo_pago IN ('efectivo', 'transferencia', 'tarjeta', 'obra_social', 'otro')),
  moneda TEXT NOT NULL DEFAULT 'Pesos' CHECK (moneda IN ('Pesos', 'Dólares')),

  monto_original NUMERIC NOT NULL CHECK (monto_original > 0),
  monto_pesos NUMERIC NOT NULL CHECK (monto_pesos >= 0),
  saldo_pendiente NUMERIC NOT NULL DEFAULT 0 CHECK (saldo_pendiente >= 0),

  fecha_prestacion DATE,
  fecha_cobro_real DATE,
  fecha_vencimiento DATE,
  fecha_carga TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  origen_carga TEXT NOT NULL DEFAULT 'bot' CHECK (origen_carga IN ('bot', 'web', 'sheet', 'migracion')),
  referencia_id UUID REFERENCES movimientos_v2(id) ON DELETE SET NULL,
  notas TEXT,
  legacy_row_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (
    categoria IN (
      'consulta',
      'tratamiento',
      'anticipo',
      'sena',
      'cuota',
      'saldo_final',
      'cobro_pendiente',
      'otro_ingreso',
      'sueldos',
      'honorarios',
      'insumos',
      'alquiler',
      'expensas',
      'servicios',
      'impuestos',
      'mantenimiento',
      'software',
      'otro_egreso'
    )
  ),

  CHECK (
    (tipo_movimiento = 'ingreso' AND categoria IN (
      'consulta',
      'tratamiento',
      'anticipo',
      'sena',
      'cuota',
      'saldo_final',
      'cobro_pendiente',
      'otro_ingreso'
    ))
    OR
    (tipo_movimiento = 'egreso' AND categoria IN (
      'sueldos',
      'honorarios',
      'insumos',
      'alquiler',
      'expensas',
      'servicios',
      'impuestos',
      'mantenimiento',
      'software',
      'otro_egreso'
    ))
  )
);

CREATE TRIGGER trg_movimientos_v2_updated_at
BEFORE UPDATE ON movimientos_v2
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS movimiento_eventos_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movimiento_id UUID NOT NULL REFERENCES movimientos_v2(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  tipo_evento TEXT NOT NULL CHECK (tipo_evento IN ('creacion', 'cobro_parcial', 'cobro_total', 'pago_parcial', 'pago_total', 'ajuste_saldo')),
  estado_resultante TEXT CHECK (estado_resultante IS NULL OR estado_resultante IN ('pendiente', 'parcial', 'cobrado', 'pagado', 'vencido', 'cancelado')),

  monto NUMERIC NOT NULL CHECK (monto > 0),
  monto_pesos NUMERIC NOT NULL CHECK (monto_pesos >= 0),
  moneda TEXT NOT NULL DEFAULT 'Pesos' CHECK (moneda IN ('Pesos', 'Dólares')),
  metodo_pago TEXT CHECK (metodo_pago IS NULL OR metodo_pago IN ('efectivo', 'transferencia', 'tarjeta', 'obra_social', 'otro')),

  fecha_evento DATE NOT NULL DEFAULT CURRENT_DATE,
  descripcion TEXT,
  notas TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_movimiento_eventos_v2_updated_at
BEFORE UPDATE ON movimiento_eventos_v2
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_movimientos_v2_user_id ON movimientos_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_v2_tipo_movimiento ON movimientos_v2(tipo_movimiento);
CREATE INDEX IF NOT EXISTS idx_movimientos_v2_categoria ON movimientos_v2(categoria);
CREATE INDEX IF NOT EXISTS idx_movimientos_v2_estado_pago ON movimientos_v2(estado_pago);
CREATE INDEX IF NOT EXISTS idx_movimientos_v2_paciente_nombre ON movimientos_v2(paciente_nombre);
CREATE INDEX IF NOT EXISTS idx_movimientos_v2_profesional_nombre ON movimientos_v2(profesional_nombre);
CREATE INDEX IF NOT EXISTS idx_movimientos_v2_fecha_prestacion ON movimientos_v2(fecha_prestacion);
CREATE INDEX IF NOT EXISTS idx_movimientos_v2_fecha_vencimiento ON movimientos_v2(fecha_vencimiento);
CREATE UNIQUE INDEX IF NOT EXISTS idx_movimientos_v2_legacy_row_id_unique ON movimientos_v2(legacy_row_id) WHERE legacy_row_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_movimiento_eventos_v2_movimiento_id ON movimiento_eventos_v2(movimiento_id);
CREATE INDEX IF NOT EXISTS idx_movimiento_eventos_v2_user_id ON movimiento_eventos_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_movimiento_eventos_v2_tipo_evento ON movimiento_eventos_v2(tipo_evento);
CREATE INDEX IF NOT EXISTS idx_movimiento_eventos_v2_fecha_evento ON movimiento_eventos_v2(fecha_evento);

ALTER TABLE movimientos_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimiento_eventos_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own movimientos_v2" ON movimientos_v2
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own movimientos_v2" ON movimientos_v2
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own movimientos_v2" ON movimientos_v2
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own movimientos_v2" ON movimientos_v2
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view own movimiento_eventos_v2" ON movimiento_eventos_v2
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own movimiento_eventos_v2" ON movimiento_eventos_v2
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own movimiento_eventos_v2" ON movimiento_eventos_v2
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own movimiento_eventos_v2" ON movimiento_eventos_v2
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = user_id
        AND p.web_user_id = auth.uid()
    )
  );

-- Ejemplos de uso previstos:
-- 1. Ingreso cobrado al contado
--    tipo_movimiento='ingreso', categoria='consulta', estado_pago='cobrado', saldo_pendiente=0
--
-- 2. Ingreso pendiente
--    tipo_movimiento='ingreso', categoria='tratamiento', estado_pago='pendiente', saldo_pendiente=monto_original
--
-- 3. Egreso pagado
--    tipo_movimiento='egreso', categoria='insumos', estado_pago='pagado', saldo_pendiente=0
--
-- 4. Cobro parcial
--    a) movimiento base en movimientos_v2 con estado_pago='parcial'
--    b) evento en movimiento_eventos_v2 con tipo_evento='cobro_parcial'
