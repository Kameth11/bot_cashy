-- =====================================
-- Fecha de cobro real (cuándo se cobró un pendiente, distinto de la fecha
-- original del movimiento). Nullable: no rompe nada en producción.
-- Se stampea solo en la transición Pendiente -> Cobrado (ver
-- src/services/command.service.js doEjecutarCobrar y
-- src/services/db.service.js updateMovimiento).
-- =====================================

ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS fecha_cobro DATE;
