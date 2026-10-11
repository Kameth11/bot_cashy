-- =====================================
-- Cashy Bot - movimientos.fecha_iso (fecha real) — PLAN_BASE_DE_DATOS.md, fase 2
-- =====================================
-- `movimientos.fecha` es TEXT y hoy mezcla formatos: las filas nuevas guardan
-- 'AAAA-MM-DD' (el código usa toDbDate) y las viejas pueden tener 'DD/MM/AAAA'.
-- Eso impide filtrar/ordenar por fecha en la base. Se AGREGA una columna DATE sin
-- tocar `fecha`, así el código actual sigue andando igual:
--   * un trigger la calcula desde `fecha` en cada INSERT / UPDATE de `fecha`
--     (no hay que cambiar el código ni puede quedar desincronizada);
--   * se rellena una vez para las filas existentes;
--   * lo que no se pueda interpretar queda en NULL (se ve con verificar_estado.sql).
-- ADITIVA e IDEMPOTENTE. Conviene tener un respaldo reciente antes de correrla en
-- producción (RESPALDOS.md), aunque no modifica ni borra ningún dato existente.
-- =====================================

ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS fecha_iso DATE;

CREATE OR REPLACE FUNCTION movimientos_fecha_a_iso(texto TEXT)
RETURNS DATE
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  t TEXT := btrim(COALESCE(texto, ''));
  m TEXT[];
BEGIN
  IF t ~ '^\d{4}-\d{2}-\d{2}' THEN
    RETURN substr(t, 1, 10)::date;
  END IF;
  m := regexp_match(t, '^(\d{1,2})/(\d{1,2})/(\d{4})');
  IF m IS NOT NULL THEN
    RETURN make_date(m[3]::int, m[2]::int, m[1]::int);
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL; -- fecha imposible (p. ej. 31/02)
END $$;

CREATE OR REPLACE FUNCTION movimientos_set_fecha_iso()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.fecha_iso := movimientos_fecha_a_iso(NEW.fecha);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_movimientos_fecha_iso ON movimientos;
CREATE TRIGGER trg_movimientos_fecha_iso
BEFORE INSERT OR UPDATE OF fecha ON movimientos
FOR EACH ROW EXECUTE FUNCTION movimientos_set_fecha_iso();

-- Rellena las filas existentes (solo las que todavía no la tienen).
UPDATE movimientos
SET fecha_iso = movimientos_fecha_a_iso(fecha)
WHERE fecha_iso IS NULL AND fecha IS NOT NULL AND fecha <> '';

CREATE INDEX IF NOT EXISTS idx_movimientos_tenant_fecha_iso ON movimientos(tenant_id, fecha_iso);

-- Se registra solo si la 017 ya se corrió (si no, no pasa nada: correr la 017 después).
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    INSERT INTO schema_migrations (version, descripcion) VALUES ('018', 'movimientos.fecha_iso (DATE) con trigger')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END $$;
