-- =====================================
-- Cashy Bot - ¿Qué tiene realmente la base de datos?
-- =====================================
-- SOLO LECTURA: no modifica nada. Pegar en el SQL editor de Supabase y correr
-- cada consulta por separado (el editor muestra el resultado de la última).
-- Existe porque las migraciones se corren a mano y no queda registro de cuáles
-- se aplicaron (ver PLAN_BASE_DE_DATOS.md, fase 1).
-- =====================================

-- ── 1) ¿Qué migraciones están aplicadas? ─────────────────────────────────────
-- aplicada = false significa que esa migración (o parte de ella) no está.
WITH
  tabla(n) AS (SELECT table_name::text FROM information_schema.tables WHERE table_schema = 'public'),
  col(t, c, nulo) AS (SELECT table_name::text, column_name::text, is_nullable::text FROM information_schema.columns WHERE table_schema = 'public'),
  idx(n) AS (SELECT indexname::text FROM pg_indexes WHERE schemaname = 'public')
SELECT * FROM (VALUES
  ('001', 'tenants y tenant_id en movimientos',
     EXISTS (SELECT 1 FROM tabla WHERE n = 'tenants') AND EXISTS (SELECT 1 FROM col WHERE t = 'movimientos' AND c = 'tenant_id')),
  ('003', 'tenant_id obligatorio en movimientos',
     EXISTS (SELECT 1 FROM col WHERE t = 'movimientos' AND c = 'tenant_id' AND nulo = 'NO')),
  ('004', 'índice tenant + user + created_at',
     EXISTS (SELECT 1 FROM idx WHERE n = 'idx_movimientos_tenant_user_created')),
  ('005', 'movimientos.fecha_cobro',
     EXISTS (SELECT 1 FROM col WHERE t = 'movimientos' AND c = 'fecha_cobro')),
  ('006', 'tabla tenant_requests',
     EXISTS (SELECT 1 FROM tabla WHERE n = 'tenant_requests')),
  ('007', 'profiles.permisos',
     EXISTS (SELECT 1 FROM col WHERE t = 'profiles' AND c = 'permisos')),
  ('008', 'tablas de Personal',
     EXISTS (SELECT 1 FROM tabla WHERE n = 'movimientos_personales') AND EXISTS (SELECT 1 FROM tabla WHERE n = 'viajes_personales')
     AND EXISTS (SELECT 1 FROM tabla WHERE n = 'presupuestos_personales')),
  ('009', 'profiles.modo_full_ia',
     EXISTS (SELECT 1 FROM col WHERE t = 'profiles' AND c = 'modo_full_ia')),
  ('010', 'profesionales.consultorio',
     EXISTS (SELECT 1 FROM col WHERE t = 'profesionales' AND c = 'consultorio')),
  ('011', 'tabla comprobantes',
     EXISTS (SELECT 1 FROM tabla WHERE n = 'comprobantes')),
  ('012', 'profiles.casas',
     EXISTS (SELECT 1 FROM col WHERE t = 'profiles' AND c = 'casas')),
  ('013', 'Personal por persona (preferencias de ámbito)',
     EXISTS (SELECT 1 FROM tabla WHERE n = 'preferencias_ambito_personales')),
  ('014', 'profiles.google_sub',
     EXISTS (SELECT 1 FROM col WHERE t = 'profiles' AND c = 'google_sub')),
  ('015', 'tabla chat_historial',
     EXISTS (SELECT 1 FROM tabla WHERE n = 'chat_historial')),
  ('016', 'tabla auth_codes',
     EXISTS (SELECT 1 FROM tabla WHERE n = 'auth_codes'))
) AS v(migracion, que_crea, aplicada)
ORDER BY migracion;

-- ── 2) RLS y políticas por tabla ─────────────────────────────────────────────
-- Todas deberían tener rls_activo = true. "politicas" lista quién puede acceder
-- (lo esperado: solo service_role; una tabla con RLS y sin políticas también
-- está bien: nadie salvo el service role puede leerla).
SELECT c.relname AS tabla,
       c.relrowsecurity AS rls_activo,
       COALESCE(string_agg(DISTINCT p.policyname || ' → ' || array_to_string(p.roles, ','), E'\n'), '(sin políticas)') AS politicas
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public' AND c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;

-- ── 3) Datos que deberían estar bien ─────────────────────────────────────────
-- Todos deberían dar 0.
SELECT
  (SELECT count(*) FROM profiles WHERE tenant_id IS NULL)                          AS perfiles_sin_tenant,
  (SELECT count(*) FROM movimientos WHERE tenant_id IS NULL)                       AS movimientos_sin_tenant,
  (SELECT count(*) FROM movimientos WHERE estado NOT IN ('Cobrado', 'Pendiente'))  AS movimientos_estado_raro,
  (SELECT count(*) FROM movimientos WHERE tipo NOT IN ('Ingreso', 'Egreso'))       AS movimientos_tipo_raro,
  (SELECT count(*) FROM movimientos WHERE fecha !~ '^\d{2}/\d{2}/\d{4}$')          AS movimientos_fecha_con_otro_formato;
