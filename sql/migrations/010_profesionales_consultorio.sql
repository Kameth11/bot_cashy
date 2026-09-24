-- =====================================
-- Consultorio por profesional
-- =====================================
-- CONSULTORIO_MAP (src/config/index.js) es un mapeo consultorio -> nombre
-- hardcodeado en el código, con los 3 consultorios del único tenant real de
-- hoy. No escala a SaaS: cada tenant nuevo necesitaría un deploy de código
-- para configurar sus propios consultorios.
--
-- Ahora cada profesional declara su consultorio al hacer /profesional (ver
-- src/handlers/commands/profesional.js), y agenda.service.js arma el mapeo
-- por tenant a partir de esta columna (src/services/profesional.service.js,
-- listarConsultoriosAsignados). Si el tenant no tiene Supabase, o todavía
-- nadie cargó su consultorio, se sigue usando CONSULTORIO_MAP como fallback
-- — así el tenant existente no se rompe aunque nadie corra /profesional de
-- nuevo, y un tenant sin Supabase no pierde la función.
--
-- PROPUESTA — no se corrió todavía. Ejecutar manualmente en Supabase.
-- =====================================

ALTER TABLE profesionales ADD COLUMN IF NOT EXISTS consultorio TEXT;
