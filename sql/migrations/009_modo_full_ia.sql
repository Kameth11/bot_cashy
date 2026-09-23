-- =====================================
-- modoFullIA en profiles
-- =====================================
-- setModoFullIA (cliente.service.js) siempre actualizó clientes.json, pero
-- Supabase nunca tuvo dónde guardarlo: buildProfileRow no incluía el campo
-- porque la columna no existe. Con Supabase como fuente de verdad
-- (USE_SUPABASE=true), un restart del proceso pierde el modoFullIA que el
-- dueño haya activado con /modoia — vuelve a leer clientes.json local, que
-- en Railway se borra en cada deploy.
--
-- PROPUESTA — no se corrió todavía. Revisar y ejecutar manualmente cuando
-- se decida empezar a persistir esto en Supabase (implica también actualizar
-- buildProfileRow en cliente.service.js para incluir el campo, y el mapeo de
-- cargarClientes para leerlo de vuelta).
-- =====================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS modo_full_ia BOOLEAN NOT NULL DEFAULT false;
