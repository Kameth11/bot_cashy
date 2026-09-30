-- =====================================
-- Cashy Bot - Comprobantes (facturas, tickets, transferencias)
-- =====================================
-- Comprobantes leídos de fotos/PDFs (ver PLAN_COMPROBANTES.md). La fuente de
-- verdad es la pestaña "Comprobantes" del Google Sheet del dueño; esta tabla
-- es el dual-write cuando USE_SUPABASE=true. El código detecta si existe
-- (resolverCapacidades en comprobante-archivo.service.js) y si no, sigue
-- funcionando solo con Sheets + file_id de Telegram.
--
-- También crea el bucket PRIVADO de Storage "comprobantes" para guardar la
-- imagen/PDF original. Solo lo lee el backend con la service role key
-- (GET /api/comprobantes/:id/archivo, que chequea permisos); nunca se
-- expone una URL pública. Path: <tenant_id>/<AAAA-MM>/<id_comprobante>.<ext>
--
-- Los ítems van en una columna jsonb (no en una tabla aparte): se leen
-- siempre junto con el comprobante y no se consultan por separado.
--
-- Este script es IDEMPOTENTE: se puede correr varias veces sin error.
-- PROPUESTA — ejecutar manualmente en el SQL editor de Supabase.
-- =====================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS comprobantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  -- ID_Comprobante de la pestaña del Sheet (comp_<ts>_<rand>).
  legacy_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('factura', 'transferencia')),
  ambito TEXT NOT NULL DEFAULT 'consultorio' CHECK (ambito IN ('consultorio', 'personal')),

  emisor TEXT,
  cuit TEXT,
  tipo_comprobante TEXT,
  numero TEXT,
  fecha_emision DATE,
  fecha_vencimiento DATE,
  total NUMERIC,
  moneda TEXT NOT NULL DEFAULT 'Pesos',

  -- SHA-256 del archivo: detecta "la misma foto dos veces".
  hash TEXT,
  -- "sb:<path en el bucket>" o "tg:<file_id de Telegram>".
  archivo TEXT,
  mime_type TEXT,

  -- ID_Unico del movimiento (consultorio) o ID_Mov (personal).
  id_movimiento TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  cargado_por BIGINT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comprobantes_tenant_legacy
  ON comprobantes(tenant_id, legacy_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_tenant_hash
  ON comprobantes(tenant_id, hash);
CREATE INDEX IF NOT EXISTS idx_comprobantes_tenant_movimiento
  ON comprobantes(tenant_id, id_movimiento);

-- Sin políticas: solo el backend (service role) accede. Con RLS activo y sin
-- políticas, la anon key no ve nada.
ALTER TABLE comprobantes ENABLE ROW LEVEL SECURITY;

-- Bucket privado para los archivos originales.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('comprobantes', 'comprobantes', false, 10485760)
ON CONFLICT (id) DO NOTHING;
