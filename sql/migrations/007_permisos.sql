-- Agrega columna permisos al perfil del dueño.
-- Es un JSONB que mapea userId de invitado (string) → array de permisos.
-- Ejemplo: { "987654321": ["ver_agenda", "editar_agenda"] }
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS permisos JSONB DEFAULT '{}';

-- Backfill: los invitados actuales en usuarios[] reciben todos los permisos
-- para no perder acceso en el momento del deploy.
UPDATE profiles
SET permisos = (
  SELECT jsonb_object_agg(
    uid::text,
    '["ver_agenda","editar_agenda","ver_movimientos","cargar_movimientos","editar_movimientos","ver_balance"]'::jsonb
  )
  FROM unnest(usuarios) AS uid
)
WHERE array_length(usuarios, 1) > 0
  AND (permisos IS NULL OR permisos = '{}');
