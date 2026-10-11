-- =====================================
-- Cashy Bot - restricciones en movimientos — PLAN_BASE_DE_DATOS.md, fase 2
-- =====================================
-- `estado`, `tipo` y `moneda` son TEXT libres: un typo o un valor raro entra sin
-- error y después rompe balances. Se agregan CHECK como NOT VALID: se aplican a las
-- escrituras NUEVAS pero NO revisan las filas existentes, así que la migración no
-- puede fallar por datos viejos.
--
-- ANTES de correrla en producción: sql/verificar_estado.sql, consulta 3, tiene que
-- dar 0 en estado/tipo/moneda raros (si no, el código podría estar escribiendo
-- valores que ahora se rechazarían).
-- `tipo` se compara sin distinguir mayúsculas porque el código escribe 'ingreso' /
-- 'egreso' en minúscula y el default de la columna es 'Ingreso'.
--
-- OJO: aunque sea NOT VALID, una fila vieja que ya incumpla la regla va a fallar si
-- se la EDITA (Postgres revisa la fila completa al actualizarla). Por eso el
-- control previo de arriba es obligatorio, no opcional.
--
-- DESPUÉS, cuando la consulta 3 dé 0 en todo, validar las filas viejas (manual):
--   ALTER TABLE movimientos VALIDATE CONSTRAINT movimientos_estado_chk;
--   ALTER TABLE movimientos VALIDATE CONSTRAINT movimientos_tipo_chk;
--   ALTER TABLE movimientos VALIDATE CONSTRAINT movimientos_moneda_chk;
-- IDEMPOTENTE.
-- =====================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimientos_estado_chk') THEN
    ALTER TABLE movimientos ADD CONSTRAINT movimientos_estado_chk
      CHECK (estado IN ('Cobrado', 'Pendiente')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimientos_tipo_chk') THEN
    ALTER TABLE movimientos ADD CONSTRAINT movimientos_tipo_chk
      CHECK (lower(tipo) IN ('ingreso', 'egreso')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimientos_moneda_chk') THEN
    ALTER TABLE movimientos ADD CONSTRAINT movimientos_moneda_chk
      CHECK (moneda IN ('Pesos', 'Dólares', 'Euros')) NOT VALID;
  END IF;
END $$;

INSERT INTO schema_migrations (version, descripcion) VALUES ('019', 'restricciones estado/tipo/moneda en movimientos (NOT VALID)')
ON CONFLICT (version) DO NOTHING;
