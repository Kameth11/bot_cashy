-- =====================================
-- Cashy Bot - Migración: campos extendidos en `movimientos`
-- =====================================
-- Ejecutar en: Supabase Dashboard → SQL Editor
--
-- Agrega las columnas que usa el panel "Nuevo movimiento" del dashboard
-- (Paciente, Profesional, Tratamiento, Proveedor, Fecha de prestación,
-- Fecha de vencimiento) directamente a la tabla `movimientos`, para que
-- se guarden y se lean sin depender de `movimientos_v2`.
-- =====================================

ALTER TABLE movimientos
  ADD COLUMN IF NOT EXISTS paciente TEXT,
  ADD COLUMN IF NOT EXISTS profesional TEXT,
  ADD COLUMN IF NOT EXISTS tratamiento TEXT,
  ADD COLUMN IF NOT EXISTS proveedor TEXT,
  ADD COLUMN IF NOT EXISTS fecha_prestacion DATE,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;
