-- =====================================
-- Casas compartidas: pertenencia en profiles
-- =====================================
-- Cada cuenta guarda a qué casas pertenece: [{ "casaId", "ownerId", "nombre" }].
-- Los datos de la casa (miembros, gastos) viven en pestañas del sheet de la
-- cuenta que la creó (Casas, CasaMiembros, CasaMovimientos); esta columna es
-- solo el índice "a qué casas pertenezco y en el sheet de quién están".
--
-- ORDEN: correr ESTA migración ANTES de crear la primera casa en producción.
-- El código solo manda la columna `casas` en los perfiles que la tienen, así
-- que sin la migración el resto de las cuentas sigue funcionando, pero el
-- perfil de quien cree una casa no se podría sincronizar con Supabase (y
-- clientes.json se borra en cada deploy en Railway).
--
-- PROPUESTA — no se corrió. Revisar y ejecutar manualmente.
-- =====================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS casas JSONB NOT NULL DEFAULT '[]'::jsonb;
