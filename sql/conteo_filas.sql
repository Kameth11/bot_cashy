-- Cantidad de filas por tabla de public (solo lectura). Lo usa el respaldo para
-- dejar un "recibo" de qué había en la base, y la restauración para comprobar
-- que volvió todo. Salida: una línea "tabla filas" por tabla.
SELECT t.table_name AS tabla,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM %I.%I', t.table_schema, t.table_name), false, true, '')))[1]::text::bigint AS filas
FROM information_schema.tables t
WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name;
