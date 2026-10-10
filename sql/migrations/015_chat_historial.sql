-- =====================================
-- Cashy Bot - Historial del chat web
-- =====================================
-- Guarda la conversación del chat del dashboard (src/lib/canal-web.js) para que
-- sobreviva a los deploys. Es UNA fila por persona con sus últimos mensajes
-- (el código recorta a 150 y descarta los de más de 30 días), no una fila por
-- mensaje: el chat se lee y se escribe entero.
--
-- Es el historial de la CONVERSACIÓN, no de los movimientos: estos viven donde
-- siempre (Sheets / Supabase). Contiene lo que la persona escribió y lo que
-- contestó el bot (montos, pacientes...), por eso es privado de cada persona
-- (forPersona) y solo lo lee el service role.
--
-- IDEMPOTENTE. Sin esta tabla el chat funciona igual, solo que el historial se
-- pierde en cada deploy. Ejecutar manualmente en el SQL editor de Supabase.
-- =====================================

CREATE TABLE IF NOT EXISTS chat_historial (
  user_id BIGINT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  mensajes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ultimo_id INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CASCADE (a diferencia de las tablas personales): el historial es descartable
-- y no debe impedir dar de baja un perfil.

DROP TRIGGER IF EXISTS trg_chat_historial_updated_at ON chat_historial;
CREATE TRIGGER trg_chat_historial_updated_at
BEFORE UPDATE ON chat_historial
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_chat_historial_tenant ON chat_historial (tenant_id);

ALTER TABLE chat_historial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS solo_service_role ON chat_historial;
CREATE POLICY solo_service_role ON chat_historial
  FOR ALL TO service_role USING (true) WITH CHECK (true);
